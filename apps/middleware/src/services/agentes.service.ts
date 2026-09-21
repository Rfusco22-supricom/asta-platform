import { prisma } from '../config/prisma.js';
import { searchRead, readGroup } from '../odoo/client.js';
import { authEnv } from '../config/authEnv.js';

/**
 * Estadísticas de los agentes de venta, para el panel de administración.
 *
 * ── De dónde sale cada cosa ──────────────────────────────────────────────────
 *
 * La cartera y la facturación, de ODOO en vivo. El acceso al panel, de MySQL.
 * Son dos preguntas distintas y se responden juntas a propósito: «quién vende
 * cuánto» y «quién puede entrar a verlo» solo sirven de verdad la una al lado de
 * la otra.
 *
 * Eso es lo que destapó #81: la persona con la cartera más grande de la empresa
 * —260 clientes, 2,5 M facturados— no tenía cuenta, y no había ninguna pantalla
 * donde eso se viera. Aquí sale en la misma fila.
 *
 * ── Lo que NO se calcula aquí ────────────────────────────────────────────────
 *
 * Nada de objetivos ni comparaciones contra cuota: no existe el dato de objetivo
 * en ninguna parte. Una tabla que ordena por facturación no es un ranking de
 * desempeño, y conviene no presentarla como tal — una cartera heredada de 200
 * clientes y otra levantada desde cero no se comparan por el total.
 */

export interface Agente {
  odooUserId: number;
  nombre: string;
  login: string;
  /** Si el usuario está activo en Odoo. Un inactivo con cartera es una alerta. */
  activoEnOdoo: boolean;

  /** Clientes de primer nivel asignados. */
  clientes: number;
  /** De esos, cuántos han comprado alguna vez. El resto son cartera por trabajar. */
  conCompra: number;

  facturado: number;
  porCobrar: number;
  facturas: number;

  // ── Acceso al panel ───────────────────────────────────────────────────────
  /** null = no tiene cuenta en el panel. */
  cuenta: {
    email: string;
    activa: boolean;
    /** false = existe la cuenta pero nadie le ha puesto contraseña. */
    puedeEntrar: boolean;
    ultimoAcceso: string | null;
  } | null;
}

export interface ResumenAgentes {
  agentes: Agente[];
  totales: {
    agentes: number;
    clientes: number;
    facturado: number;
    porCobrar: number;
    /** Cuántos no pueden usar el panel: sin cuenta, o con cuenta sin contraseña. */
    sinAcceso: number;
  };
  generadoEn: string;
  duracionMs: number;
}

interface UsuarioOdoo {
  id: number;
  name: string;
  login: string;
  active: boolean;
}

/**
 * Lo facturado por cliente, por lotes de 250.
 *
 * El tamaño del lote no es arbitrario: con los 2.629 partners de la instancia en
 * un solo `in`, Odoo se pasa del timeout de 30 s. El coste crece mucho más
 * deprisa que el número de ids — 250 → 0,6 s, 500 → 1,7 s, 1.000 → 6,3 s — así
 * que sale más barato repetir la llamada que agrandarla. Medido en #81.
 */
async function facturacionPorPartner(ids: number[]): Promise<
  Map<number, { total: number; porCobrar: number; facturas: number }>
> {
  const mapa = new Map<number, { total: number; porCobrar: number; facturas: number }>();
  const LOTE = 250;

  for (let i = 0; i < ids.length; i += LOTE) {
    const grupos = await readGroup<{
      commercial_partner_id: [number, string] | false;
      amount_total_signed: number;
      amount_residual_signed: number;
      __count: number;
    }>(
      'account.move',
      [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['commercial_partner_id', 'in', ids.slice(i, i + LOTE)],
      ],
      ['amount_total_signed:sum', 'amount_residual_signed:sum'],
      ['commercial_partner_id'],
    );

    for (const g of grupos) {
      if (!g.commercial_partner_id) continue;
      mapa.set(g.commercial_partner_id[0], {
        total: g.amount_total_signed ?? 0,
        porCobrar: g.amount_residual_signed ?? 0,
        facturas: g.__count,
      });
    }
  }

  return mapa;
}

export async function estadisticasAgentes(): Promise<ResumenAgentes> {
  const t0 = Date.now();

  // ── Quién tiene cartera ───────────────────────────────────────────────────
  const partners = await searchRead<{ id: number; user_id: [number, string] | false }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['user_id', '!=', false],
      ['parent_id', '=', false],
      ['active', '=', true],
    ],
    ['id', 'user_id'],
  );

  const porUsuario = new Map<number, { nombre: string; partners: number[] }>();
  for (const p of partners) {
    if (!p.user_id) continue;
    const [uid, nombre] = p.user_id;
    if (!porUsuario.has(uid)) porUsuario.set(uid, { nombre, partners: [] });
    porUsuario.get(uid)!.partners.push(p.id);
  }

  if (porUsuario.size === 0) {
    return {
      agentes: [],
      totales: { agentes: 0, clientes: 0, facturado: 0, porCobrar: 0, sinAcceso: 0 },
      generadoEn: new Date().toISOString(),
      duracionMs: Date.now() - t0,
    };
  }

  const uids = [...porUsuario.keys()];

  const [facturacion, usuarios, cuentas] = await Promise.all([
    facturacionPorPartner([...porUsuario.values()].flatMap((v) => v.partners)),

    /*
     * Se piden también los INACTIVOS.
     *
     * Odoo añade `active = true` por su cuenta a todo dominio que no mencione
     * ese campo, así que sin el `|` explícito los de baja no vendrían — y son
     * justo los que hay que ver: un agente inactivo con cartera asignada
     * significa que esos clientes no los está atendiendo nadie.
     */
    searchRead<UsuarioOdoo>(
      'res.users',
      ['|', ['active', '=', true], ['active', '=', false], ['id', 'in', uids]],
      ['id', 'name', 'login', 'active'],
    ),

    prisma.appUser.findMany({
      where: { odooUserId: { in: uids } },
      select: {
        odooUserId: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        credentials: { select: { userId: true } },
      },
    }),
  ]);

  const infoOdoo = new Map(usuarios.map((u) => [u.id, u]));
  const infoCuenta = new Map(cuentas.map((c) => [c.odooUserId!, c]));

  const agentes: Agente[] = [...porUsuario.entries()].map(([uid, v]) => {
    const u = infoOdoo.get(uid);
    const c = infoCuenta.get(uid);

    let facturado = 0;
    let porCobrar = 0;
    let facturas = 0;
    let conCompra = 0;

    for (const id of v.partners) {
      const f = facturacion.get(id);
      if (!f) continue;
      facturado += f.total;
      porCobrar += f.porCobrar;
      facturas += f.facturas;
      // «Con compra» es haber facturado, no tener saldo: un cliente que paga al
      // contado cuenta igual que uno que debe.
      if (f.facturas > 0) conCompra++;
    }

    return {
      odooUserId: uid,
      nombre: (u?.name ?? v.nombre).trim(),
      login: u?.login ?? '',
      activoEnOdoo: u?.active ?? false,
      clientes: v.partners.length,
      conCompra,
      facturado: Math.round(facturado * 100) / 100,
      porCobrar: Math.round(porCobrar * 100) / 100,
      facturas,
      cuenta: c
        ? {
            email: c.email,
            activa: c.isActive,
            // Con el login de Odoo (#85), el personal entra sin contraseña del panel.
            puedeEntrar: c.isActive && (c.credentials !== null || authEnv().LOGIN_ODOO),
            ultimoAcceso: c.lastLoginAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  agentes.sort((a, b) => b.facturado - a.facturado);

  return {
    agentes,
    totales: {
      agentes: agentes.length,
      clientes: agentes.reduce((s, a) => s + a.clientes, 0),
      facturado: Math.round(agentes.reduce((s, a) => s + a.facturado, 0) * 100) / 100,
      porCobrar: Math.round(agentes.reduce((s, a) => s + a.porCobrar, 0) * 100) / 100,
      // Cuenta a los activos en Odoo: que un ex-empleado no pueda entrar no es
      // un problema que resolver, es lo correcto.
      sinAcceso: agentes.filter((a) => a.activoEnOdoo && !a.cuenta?.puedeEntrar).length,
    },
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };
}
