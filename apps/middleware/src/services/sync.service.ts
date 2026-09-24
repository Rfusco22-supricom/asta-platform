import type { AppRole } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { searchRead, type OdooDomain } from '../odoo/client.js';
import { normalizarEmail, esEmailPlausible } from '../auth/email.js';
import { tierFromPricelist } from '../config/tiers.js';
import { recordAudit } from './audit.service.js';
import { idTarifa, leerTarifas, nombreTarifa } from './tarifas.service.js';

/**
 * Sincronización res.partner → app_users (issue #15).
 *
 * ── Qué copia y qué no ───────────────────────────────────────────────────────
 *
 * Copia lo imprescindible para que el login y los permisos funcionen sin Odoo
 * delante: quién es, qué rol tiene, a qué vendedor pertenece. NADA de negocio:
 * precios, facturas y stock se siguen leyendo en vivo. El día que una cifra de
 * facturación se guarde aquí, se habrá roto el principio que sostiene todo.
 *
 * ── Lo que los datos reales obligan a asumir ─────────────────────────────────
 *
 * Medido sobre la instancia (2944 clientes activos):
 *
 *   · 512 (17,4%) NO tienen email. El email es el login, así que no pueden
 *     tener cuenta. No es un error: son clientes de mostrador.
 *   · 138 correos están compartidos por varios partners — 303 afectados. Y en
 *     su mayoría NO son duplicados sucios: son grupos de empresas con un
 *     correo de facturación común (BOTICA EL JAVILLO, C.G. DE HASETH y
 *     LABORATORIO EL JAVILLO comparten fact.electronica@grupodehaseth.com).
 *
 * `app_users.email` es único, así que de cada correo compartido solo UNO puede
 * tener cuenta. Se elige el de mayor `customer_rank` —el que más ha comprado—
 * y el resto se registra como omitido, con el motivo.
 *
 * ESO ES UNA LIMITACIÓN DEL MODELO, no un detalle de implementación: hoy una
 * persona que gestiona cuatro empresas solo verá una. Arreglarlo de verdad
 * exige romper el 1:1 entre usuario y partner, que es una decisión de producto.
 * Mientras tanto, el informe dice exactamente a cuántos afecta.
 */

export type ResultadoFila =
  | 'CREADO'
  | 'ACTUALIZADO'
  | 'SIN_CAMBIOS'
  | 'OMITIDO_SIN_EMAIL'
  | 'OMITIDO_EMAIL_INVALIDO'
  | 'OMITIDO_EMAIL_EN_USO'
  | 'FALLIDO';

export interface ResumenSync {
  entidad: string;
  desde: string | null;
  hasta: string | null;
  leidos: number;
  creados: number;
  actualizados: number;
  sinCambios: number;
  omitidosSinEmail: number;
  omitidosEmailInvalido: number;
  omitidosEmailEnUso: number;
  fallidos: number;
  duracionMs: number;
  /** Detalle de los que no entraron, para poder actuar sobre ellos. */
  incidencias: Array<{ odooPartnerId: number; nombre: string; motivo: ResultadoFila; detalle?: string }>;
}

interface PartnerRow {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  write_date: string;
  customer_rank: number;
  user_id: [number, string] | false;
  commercial_partner_id: [number, string] | false;
}

const CAMPOS = [
  'id',
  'name',
  'email',
  'phone',
  'write_date',
  'customer_rank',
  'user_id',
  'commercial_partner_id',
  // `property_product_pricelist` NO va aquí: leído junto al resto, sale el de la
  // compañía por defecto del usuario de servicio. Ver `tarifas.service.ts`.
] as const;

const ENTIDAD = 'res.partner';
const LOTE = 500;

/**
 * Margen que se retrocede sobre la marca de agua.
 *
 * `write_date` tiene resolución de segundo. Si la pasada anterior terminó justo
 * en el segundo en que Odoo escribía otro partner, ese registro quedaría por
 * debajo del corte y NO se volvería a mirar nunca. Retroceder un minuto hace que
 * unos pocos registros se reprocesen —cosa inofensiva, el upsert es idempotente—
 * a cambio de no perder ninguno.
 */
const MARGEN_SEGUNDOS = 60;

/** Una ejecución que lleva más de esto colgada se da por muerta. */
const CERROJO_CADUCA_MIN = 30;

function restarSegundos(fechaOdoo: string, segundos: number): string {
  const t = Date.parse(fechaOdoo.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return fechaOdoo;
  return new Date(t - segundos * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** El rol sale de la tarifa: `x_client_tier` no existe en esta instancia (#3). */
function rolDe(pricelistId: number | null, esStaff: boolean): AppRole {
  return esStaff ? 'VENDEDOR' : tierFromPricelist(pricelistId);
}

export async function sincronizarPartners(
  opciones: { completo?: boolean; limite?: number } = {},
): Promise<ResumenSync> {
  const t0 = Date.now();

  // ── Cerrojo ───────────────────────────────────────────────────────────────
  // Dos pasadas a la vez se pisarían: la segunda leería una marca de agua que
  // la primera aún no ha escrito y duplicaría trabajo.
  const estado = await prisma.syncState.findUnique({ where: { entidad: ENTIDAD } });
  const colgada =
    estado?.ejecutando &&
    estado.ejecutandoDesde &&
    Date.now() - estado.ejecutandoDesde.getTime() > CERROJO_CADUCA_MIN * 60_000;

  if (estado?.ejecutando && !colgada) {
    throw new Error('Ya hay una sincronización en curso.');
  }

  await prisma.syncState.upsert({
    where: { entidad: ENTIDAD },
    create: { entidad: ENTIDAD, ejecutando: true, ejecutandoDesde: new Date() },
    update: { ejecutando: true, ejecutandoDesde: new Date() },
  });

  const resumen: ResumenSync = {
    entidad: ENTIDAD,
    desde: null,
    hasta: null,
    leidos: 0,
    creados: 0,
    actualizados: 0,
    sinCambios: 0,
    omitidosSinEmail: 0,
    omitidosEmailInvalido: 0,
    omitidosEmailEnUso: 0,
    fallidos: 0,
    duracionMs: 0,
    incidencias: [],
  };

  try {
    const marca = opciones.completo ? null : estado?.ultimoWriteDate ?? null;
    resumen.desde = marca;

    const domain: OdooDomain = [
      ['customer_rank', '>', 0],
      ['active', '=', true],
    ];
    if (marca) domain.push(['write_date', '>=', restarSegundos(marca, MARGEN_SEGUNDOS)]);

    // ── Lectura por lotes ───────────────────────────────────────────────────
    const filas: PartnerRow[] = [];
    for (let offset = 0; ; offset += LOTE) {
      const lote = await searchRead<PartnerRow>(ENTIDAD, domain, [...CAMPOS], {
        limit: LOTE,
        offset,
        // Por write_date ascendente: si la pasada se corta a medio camino, la
        // marca de agua que quede guardada es coherente — todo lo anterior se
        // procesó. Con otro orden, un corte dejaría huecos.
        order: 'write_date asc, id asc',
      });
      filas.push(...lote);
      if (lote.length < LOTE) break;
      if (opciones.limite && filas.length >= opciones.limite) break;
    }

    const aProcesar = opciones.limite ? filas.slice(0, opciones.limite) : filas;
    resumen.leidos = aProcesar.length;
    const tarifas = await leerTarifas(aProcesar.map((f) => f.id));

    // ── Resolver conflictos de email ANTES de escribir ──────────────────────
    // Se agrupan por correo y se elige un ganador por lote. Hacerlo fila a fila
    // dejaría que el orden de lectura decidiera quién se queda la cuenta, que
    // es tanto como decidirlo al azar.
    const porEmail = new Map<string, PartnerRow[]>();
    for (const f of aProcesar) {
      if (!f.email) continue;
      const e = normalizarEmail(String(f.email));
      if (!esEmailPlausible(e)) continue;
      const grupo = porEmail.get(e) ?? [];
      grupo.push(f);
      porEmail.set(e, grupo);
    }

    const ganadorPorEmail = new Map<string, number>();
    for (const [email, grupo] of porEmail) {
      // El que más ha comprado. Empate: el id más bajo, que es el más antiguo.
      const ganador = [...grupo].sort(
        (a, b) => b.customer_rank - a.customer_rank || a.id - b.id,
      )[0];
      ganadorPorEmail.set(email, ganador.id);
    }

    // ── Procesar ────────────────────────────────────────────────────────────
    let maxWriteDate = marca;

    for (const f of aProcesar) {
      try {
        if (f.write_date && (!maxWriteDate || f.write_date > maxWriteDate)) {
          maxWriteDate = f.write_date;
        }

        const nombre = f.name.trim();

        if (!f.email) {
          resumen.omitidosSinEmail++;
          resumen.incidencias.push({ odooPartnerId: f.id, nombre, motivo: 'OMITIDO_SIN_EMAIL' });
          continue;
        }

        const email = normalizarEmail(String(f.email));
        if (!esEmailPlausible(email)) {
          resumen.omitidosEmailInvalido++;
          resumen.incidencias.push({
            odooPartnerId: f.id,
            nombre,
            motivo: 'OMITIDO_EMAIL_INVALIDO',
            detalle: String(f.email).slice(0, 60),
          });
          continue;
        }

        if (ganadorPorEmail.get(email) !== f.id) {
          resumen.omitidosEmailEnUso++;
          resumen.incidencias.push({
            odooPartnerId: f.id,
            nombre,
            motivo: 'OMITIDO_EMAIL_EN_USO',
            detalle: `${email} se asignó al partner ${ganadorPorEmail.get(email)}`,
          });
          continue;
        }

        // Puede que ese correo ya lo tenga OTRO partner de una pasada anterior.
        const dueñoActual = await prisma.appUser.findUnique({
          where: { email },
          select: { odooPartnerId: true },
        });
        if (dueñoActual && dueñoActual.odooPartnerId !== f.id) {
          resumen.omitidosEmailEnUso++;
          resumen.incidencias.push({
            odooPartnerId: f.id,
            nombre,
            motivo: 'OMITIDO_EMAIL_EN_USO',
            detalle: `${email} ya pertenece al partner ${dueñoActual.odooPartnerId}`,
          });
          continue;
        }

        const tarifa = tarifas.get(f.id);
        const pricelistId = idTarifa(tarifa);
        const odooUserId = f.user_id ? f.user_id[0] : null;

        const datos = {
          email,
          fullName: nombre,
          phone: f.phone ? String(f.phone).trim() || null : null,
          role: rolDe(pricelistId, false),
          odooPricelistId: pricelistId,
          odooPricelistName: nombreTarifa(tarifa),
          odooCommercialId: f.commercial_partner_id ? f.commercial_partner_id[0] : f.id,
          isCustomer: (f.customer_rank ?? 0) > 0,
          syncStatus: 'SYNCED' as const,
          syncedAt: new Date(),
          syncError: null,
        };

        const existente = await prisma.appUser.findUnique({
          where: { odooPartnerId: f.id },
          select: { id: true, email: true, fullName: true, role: true, odooPricelistId: true, phone: true },
        });

        if (!existente) {
          await prisma.appUser.create({
            data: { ...datos, odooPartnerId: f.id, isActive: true },
          });
          resumen.creados++;
          continue;
        }

        // NO se toca `role` si el usuario es staff: un vendedor o un SuperAdmin
        // no puede degradarse a BRONCE porque Odoo diga que su partner tiene la
        // tarifa por defecto. El rol de staff lo decide un humano, no el sync.
        const usuarioCompleto = await prisma.appUser.findUnique({
          where: { id: existente.id },
          select: { role: true, odooUserId: true },
        });
        const esStaff =
          usuarioCompleto?.role === 'SUPERADMIN' || usuarioCompleto?.role === 'VENDEDOR';

        const cambios = { ...datos };
        if (esStaff) {
          cambios.role = usuarioCompleto!.role;
        }

        const igual =
          existente.email === cambios.email &&
          existente.fullName === cambios.fullName &&
          existente.role === cambios.role &&
          existente.odooPricelistId === cambios.odooPricelistId &&
          existente.phone === cambios.phone;

        if (igual) {
          resumen.sinCambios++;
          // Aun así se marca la fecha de sync, para poder detectar huérfanos.
          await prisma.appUser.update({
            where: { id: existente.id },
            data: { syncedAt: new Date(), syncStatus: 'SYNCED', syncError: null },
          });
          continue;
        }

        await prisma.appUser.update({ where: { id: existente.id }, data: cambios });
        resumen.actualizados++;

        void odooUserId;
      } catch (error) {
        // Una fila mala NO puede abortar el lote. Se anota y se sigue: si un
        // partner con datos corruptos tumbara la pasada, bastaría uno para que
        // la sincronización dejara de funcionar y nadie se enterase.
        resumen.fallidos++;
        const detalle = error instanceof Error ? error.message.slice(0, 200) : String(error);
        resumen.incidencias.push({
          odooPartnerId: f.id,
          nombre: f.name,
          motivo: 'FALLIDO',
          detalle,
        });

        await prisma.appUser
          .updateMany({
            where: { odooPartnerId: f.id },
            data: { syncStatus: 'FAILED', syncError: detalle },
          })
          .catch(() => {});
      }
    }

    resumen.hasta = maxWriteDate;
    resumen.duracionMs = Date.now() - t0;

    await prisma.syncState.update({
      where: { entidad: ENTIDAD },
      data: {
        ultimoWriteDate: maxWriteDate,
        ultimaEjecucion: new Date(),
        resumen: resumen as never,
        ejecutando: false,
        ejecutandoDesde: null,
      },
    });

    recordAudit({
      action: 'sync.partners',
      actorId: null,
      actorOdooUserId: null,
      targetType: 'res.partner',
      targetId: null,
      ip: null,
      metadata: {
        leidos: resumen.leidos,
        creados: resumen.creados,
        actualizados: resumen.actualizados,
        omitidos:
          resumen.omitidosSinEmail + resumen.omitidosEmailInvalido + resumen.omitidosEmailEnUso,
        fallidos: resumen.fallidos,
        ms: resumen.duracionMs,
      },
    });

    return resumen;
  } catch (error) {
    // El cerrojo se suelta pase lo que pase: dejarlo echado convertiría un
    // fallo puntual en una sincronización parada para siempre.
    await prisma.syncState
      .update({ where: { entidad: ENTIDAD }, data: { ejecutando: false, ejecutandoDesde: null } })
      .catch(() => {});
    throw error;
  }
}

/**
 * Detecta huérfanos: usuarios cuyo partner ya no existe o dejó de ser cliente.
 *
 * NO los borra. Se marcan como ORPHANED y alguien decide: puede ser que el
 * cliente se diera de baja de verdad, o que alguien archivara el partner
 * equivocado en Odoo. Borrar cuentas automáticamente por un cambio en otro
 * sistema es la clase de automatismo del que uno se arrepiente.
 */
export async function marcarHuerfanos(): Promise<{ revisados: number; huerfanos: number }> {
  const usuarios = await prisma.appUser.findMany({
    where: { role: { in: ['BRONCE', 'PLATA', 'GOLD'] } },
    select: { id: true, odooPartnerId: true },
  });
  if (usuarios.length === 0) return { revisados: 0, huerfanos: 0 };

  const ids = usuarios.map((u) => u.odooPartnerId);
  const vivos = new Set<number>();

  for (let i = 0; i < ids.length; i += 500) {
    const rows = await searchRead<{ id: number }>(
      'res.partner',
      [
        ['id', 'in', ids.slice(i, i + 500)],
        ['active', '=', true],
        ['customer_rank', '>', 0],
      ],
      ['id'],
    );
    for (const r of rows) vivos.add(r.id);
  }

  const huerfanos = usuarios.filter((u) => !vivos.has(u.odooPartnerId));
  if (huerfanos.length > 0) {
    await prisma.appUser.updateMany({
      where: { id: { in: huerfanos.map((h) => h.id) } },
      data: {
        syncStatus: 'ORPHANED',
        syncError: 'El partner ya no existe en Odoo o dejó de ser cliente.',
      },
    });
  }

  return { revisados: usuarios.length, huerfanos: huerfanos.length };
}
