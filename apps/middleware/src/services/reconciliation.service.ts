import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { normalizarEmail, esEmailPlausible } from '../auth/email.js';
import { tierFromPricelist } from '../config/tiers.js';
import { idTarifa, leerTarifas, nombreTarifa, type TarifaLeida } from './tarifas.service.js';

/**
 * Reconciliación Odoo ↔ middleware (issue #19).
 *
 * Los dos sistemas van a divergir. La pregunta no es si, sino cuándo te enteras.
 *
 * Este informe contesta cinco cosas que, por separado, nadie mira:
 *
 *   1. ¿Qué clientes de Odoo NO tienen cuenta, y por qué?
 *   2. ¿Qué cuentas existen pero NO pueden entrar (sin contraseña)?
 *   3. ¿Qué cuentas apuntan a un partner que ya no está?
 *   4. ¿Qué cuentas tienen datos distintos a los de Odoo?
 *   5. ¿Qué cuentas nunca pasaron por el sync?
 *
 * La número 2 es la que motivó escribirlo: tras la primera sincronización había
 * 2259 clientes con cuenta y CERO con contraseña. Todos tenían usuario y ninguno
 * podía entrar. Eso no lo ve nadie mirando `app_users` por encima — la tabla se
 * ve perfectamente poblada.
 */

export type MotivoSinCuenta =
  | 'SIN_EMAIL'
  | 'EMAIL_INVALIDO'
  | 'EMAIL_COMPARTIDO'
  | 'DESCONOCIDO';

export interface PartnerSinCuenta {
  odooPartnerId: number;
  nombre: string;
  email: string | null;
  motivo: MotivoSinCuenta;
  detalle?: string;
}

export interface Desalineado {
  odooPartnerId: number;
  nombre: string;
  campo: 'email' | 'nombre' | 'tarifa' | 'rol';
  enOdoo: string | null;
  enMiddleware: string | null;
}

export interface Reconciliacion {
  generadoEn: string;
  odoo: { clientesActivos: number };
  middleware: { usuarios: number; clientes: number; staff: number };

  /** Clientes de Odoo sin cuenta en el panel, con el motivo de cada uno. */
  sinCuenta: { total: number; porMotivo: Record<MotivoSinCuenta, number>; muestra: PartnerSinCuenta[] };

  /** Tienen cuenta pero no pueden entrar: nadie les ha puesto contraseña. */
  sinCredenciales: { total: number; muestra: Array<{ id: string; email: string; nombre: string }> };

  /** Su partner ya no existe en Odoo o dejó de ser cliente. */
  huerfanos: { total: number; muestra: Array<{ id: string; email: string; odooPartnerId: number }> };

  /** Los datos difieren entre los dos sistemas. */
  desalineados: { total: number; muestra: Desalineado[] };

  /** Nunca pasaron por el sync (creados a mano). */
  nuncaSincronizados: { total: number; muestra: Array<{ email: string; role: string }> };

  duracionMs: number;
}

interface PartnerOdoo {
  id: number;
  name: string;
  email: string | false;
  /** Leída desde la compañía del cliente, no junto al resto: ver `tarifas.service.ts`. */
  tarifa: TarifaLeida;
}

const MUESTRA = 25;

export async function reconciliar(): Promise<Reconciliacion> {
  const t0 = Date.now();

  // ── Lectura en bloque de los dos lados ─────────────────────────────────────
  // Se leen enteros y se comparan en memoria: son ~3000 filas por lado. Hacer
  // una consulta por partner serían 3000 RPC contra el ERP.
  const [partners, usuarios] = await Promise.all([
    leerTodosLosClientes(),
    prisma.appUser.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        odooPartnerId: true,
        odooPricelistId: true,
        syncStatus: true,
        credentials: { select: { userId: true } },
      },
    }),
  ]);

  const porPartnerId = new Map(usuarios.map((u) => [u.odooPartnerId, u]));
  const idsOdoo = new Set(partners.map((p) => p.id));
  const emailsUsados = new Set(usuarios.map((u) => u.email));

  // ── 1. Clientes de Odoo sin cuenta ─────────────────────────────────────────
  const sinCuenta: PartnerSinCuenta[] = [];
  const porMotivo: Record<MotivoSinCuenta, number> = {
    SIN_EMAIL: 0,
    EMAIL_INVALIDO: 0,
    EMAIL_COMPARTIDO: 0,
    DESCONOCIDO: 0,
  };

  for (const p of partners) {
    if (porPartnerId.has(p.id)) continue;

    let motivo: MotivoSinCuenta;
    let detalle: string | undefined;
    const crudo = p.email ? String(p.email) : '';

    if (!crudo.trim()) {
      motivo = 'SIN_EMAIL';
    } else if (!esEmailPlausible(crudo)) {
      motivo = 'EMAIL_INVALIDO';
      detalle = crudo.slice(0, 60);
    } else if (emailsUsados.has(normalizarEmail(crudo))) {
      motivo = 'EMAIL_COMPARTIDO';
      detalle = `${normalizarEmail(crudo)} ya lo usa otra cuenta`;
    } else {
      // Tiene email válido y libre pero no hay cuenta: o el sync no ha pasado
      // desde que se creó, o algo falló. Es el único motivo que merece mirarse.
      motivo = 'DESCONOCIDO';
    }

    porMotivo[motivo]++;

    // La muestra se lleva POR MOTIVO, no las 25 primeras filas.
    //
    // Con un muestreo global, los 512 'SIN_EMAIL' —que van primero y no se
    // pueden arreglar desde aquí— se comían el hueco entero, y la lista de 8
    // correos mal escritos, que es la ÚNICA sobre la que alguien puede actuar
    // hoy mismo, no llegaba nunca a la pantalla.
    const yaEnMuestra = sinCuenta.filter((x) => x.motivo === motivo).length;
    if (yaEnMuestra < MUESTRA) {
      sinCuenta.push({
        odooPartnerId: p.id,
        nombre: p.name.trim(),
        email: crudo.trim() || null,
        motivo,
        detalle,
      });
    }
  }

  // ── 2. Cuentas que no pueden entrar ────────────────────────────────────────
  const sinCred = usuarios.filter((u) => !u.credentials);

  // ── 3. Huérfanos ───────────────────────────────────────────────────────────
  // Solo clientes: un vendedor apunta a un partner interno que este informe no
  // lee, y marcarlo como huérfano sería un falso positivo.
  const huerfanos = usuarios.filter(
    (u) => ['BRONCE', 'PLATA', 'GOLD'].includes(u.role) && !idsOdoo.has(u.odooPartnerId),
  );

  // ── 4. Desalineados ────────────────────────────────────────────────────────
  const desalineados: Desalineado[] = [];
  for (const p of partners) {
    const u = porPartnerId.get(p.id);
    if (!u) continue;

    const nombreOdoo = p.name.trim();
    if (nombreOdoo !== u.fullName) {
      desalineados.push({
        odooPartnerId: p.id,
        nombre: nombreOdoo,
        campo: 'nombre',
        enOdoo: nombreOdoo,
        enMiddleware: u.fullName,
      });
    }

    const plOdoo = idTarifa(p.tarifa);
    if (plOdoo !== u.odooPricelistId) {
      desalineados.push({
        odooPartnerId: p.id,
        nombre: nombreOdoo,
        campo: 'tarifa',
        enOdoo: nombreTarifa(p.tarifa),
        enMiddleware: u.odooPricelistId === null ? null : String(u.odooPricelistId),
      });
    }

    // El rol de staff NO se compara: lo decide un humano, no Odoo. Marcarlo
    // como desalineado llenaría el informe de ruido que nadie debe "corregir".
    if (!['SUPERADMIN', 'VENDEDOR'].includes(u.role)) {
      const rolEsperado = tierFromPricelist(plOdoo);
      if (rolEsperado !== u.role) {
        desalineados.push({
          odooPartnerId: p.id,
          nombre: nombreOdoo,
          campo: 'rol',
          enOdoo: rolEsperado,
          enMiddleware: u.role,
        });
      }
    }
  }

  // ── 5. Nunca sincronizados ─────────────────────────────────────────────────
  const nunca = usuarios.filter((u) => u.syncStatus === 'PENDING');

  return {
    generadoEn: new Date().toISOString(),
    odoo: { clientesActivos: partners.length },
    middleware: {
      usuarios: usuarios.length,
      clientes: usuarios.filter((u) => ['BRONCE', 'PLATA', 'GOLD'].includes(u.role)).length,
      staff: usuarios.filter((u) => ['SUPERADMIN', 'VENDEDOR'].includes(u.role)).length,
    },
    sinCuenta: {
      total: partners.length - partners.filter((p) => porPartnerId.has(p.id)).length,
      porMotivo,
      muestra: sinCuenta,
    },
    sinCredenciales: {
      total: sinCred.length,
      muestra: sinCred.slice(0, MUESTRA).map((u) => ({
        id: u.id,
        email: u.email,
        nombre: u.fullName,
      })),
    },
    huerfanos: {
      total: huerfanos.length,
      muestra: huerfanos.slice(0, MUESTRA).map((u) => ({
        id: u.id,
        email: u.email,
        odooPartnerId: u.odooPartnerId,
      })),
    },
    desalineados: {
      total: desalineados.length,
      muestra: desalineados.slice(0, MUESTRA),
    },
    nuncaSincronizados: {
      total: nunca.length,
      muestra: nunca.slice(0, MUESTRA).map((u) => ({ email: u.email, role: u.role })),
    },
    duracionMs: Date.now() - t0,
  };
}

async function leerTodosLosClientes(): Promise<PartnerOdoo[]> {
  const out: Array<Omit<PartnerOdoo, 'tarifa'>> = [];
  for (let offset = 0; ; offset += 500) {
    const lote = await searchRead<Omit<PartnerOdoo, 'tarifa'>>(
      'res.partner',
      [
        ['customer_rank', '>', 0],
        ['active', '=', true],
      ],
      ['id', 'name', 'email'],
      { limit: 500, offset, order: 'id asc' },
    );
    out.push(...lote);
    if (lote.length < 500) break;
  }
  const tarifas = await leerTarifas(out.map((p) => p.id));
  return out.map((p) => ({ ...p, tarifa: tarifas.get(p.id) ?? false }));
}

/**
 * Vuelve a sincronizar UN partner concreto.
 *
 * Para cuando alguien arregla un dato en Odoo y no quiere esperar al cron ni
 * lanzar una pasada completa de 3000 registros solo por una fila.
 */
export async function resincronizarUno(
  odooPartnerId: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await searchRead<Omit<PartnerOdoo, 'tarifa'> & { customer_rank: number; phone: string | false }>(
    'res.partner',
    [['id', '=', odooPartnerId]],
    ['id', 'name', 'email', 'phone', 'customer_rank'],
  );

  const p = rows[0];
  if (!p) return { ok: false, mensaje: `El partner ${odooPartnerId} no existe en Odoo.` };
  const tarifa = (await leerTarifas([p.id])).get(p.id);

  const crudo = p.email ? String(p.email) : '';
  if (!crudo.trim()) return { ok: false, mensaje: 'El partner no tiene correo: no puede tener cuenta.' };
  if (!esEmailPlausible(crudo)) {
    return { ok: false, mensaje: `El correo "${crudo.slice(0, 50)}" no tiene forma válida. Arréglalo en Odoo.` };
  }

  const email = normalizarEmail(crudo);
  const enUso = await prisma.appUser.findUnique({
    where: { email },
    select: { odooPartnerId: true },
  });
  if (enUso && enUso.odooPartnerId !== odooPartnerId) {
    return {
      ok: false,
      mensaje: `El correo ${email} ya pertenece al partner ${enUso.odooPartnerId}.`,
    };
  }

  const pricelistId = idTarifa(tarifa);
  const datos = {
    email,
    fullName: p.name.trim(),
    phone: p.phone ? String(p.phone).trim() || null : null,
    odooPricelistId: pricelistId,
    odooPricelistName: nombreTarifa(tarifa),
    isCustomer: (p.customer_rank ?? 0) > 0,
    syncStatus: 'SYNCED' as const,
    syncedAt: new Date(),
    syncError: null,
  };

  const existente = await prisma.appUser.findUnique({
    where: { odooPartnerId },
    select: { id: true, role: true },
  });

  if (!existente) {
    await prisma.appUser.create({
      data: { ...datos, odooPartnerId, role: tierFromPricelist(pricelistId), isActive: true },
    });
    return { ok: true, mensaje: 'Cuenta creada.' };
  }

  // El rol de staff no se toca, igual que en el sync masivo.
  const esStaff = ['SUPERADMIN', 'VENDEDOR'].includes(existente.role);
  await prisma.appUser.update({
    where: { id: existente.id },
    data: esStaff ? datos : { ...datos, role: tierFromPricelist(pricelistId) },
  });
  return { ok: true, mensaje: 'Cuenta actualizada.' };
}
