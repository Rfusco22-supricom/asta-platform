import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { compras, smartbit, ventasDeClientes } from './smartbit.service.js';
import { totalesAstaDeCartera } from './ventasAsta.service.js';
import { dePantalla } from './pantallas.js';
import { authEnv } from '../config/authEnv.js';
import { nombrePersona } from '@asta/shared-types';

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
 * Lo que sale de Odoo: quién tiene cartera, lo vendido y los usuarios. Es lo
 * lento, y se guarda un rato (`pantallas.ts`); el acceso al panel no, que lo
 * cambia el propio administrador y tiene que verse al volver.
 */
function leerOdoo() {
  return dePantalla('admin:agentes', async () => {
    // ── Quién tiene cartera ─────────────────────────────────────────────────
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
    const uids = [...new Set(partners.flatMap((p) => (p.user_id ? [p.user_id[0]] : [])))];
    if (uids.length === 0) return { partners, facturacion: new Map<number, never>(), usuarios: [] as UsuarioOdoo[] };

    const [facturacion, usuarios] = await Promise.all([
      // Solo ASTA, como «Mi cartera» de cada vendedor (`ventasAsta.service`):
      // de toda la empresa en dos consultas, y se reparte por cartera abajo.
      totalesAstaDeCartera(null),

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
    ]);
    return { partners, facturacion, usuarios };
  });
}

export async function estadisticasAgentes(): Promise<ResumenAgentes> {
  const t0 = Date.now();

  const { partners, facturacion, usuarios } = await leerOdoo();

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

  const [cuentas, sb] = await Promise.all([
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

    smartbit(),
  ]);

  // Smartbit, lo de antes del 1-abr-2026 (`smartbit.service`): lo vendido y
  // las compras, por el vendedor que las hizo; «con compra», por la historia
  // de cada cliente de la cartera, como en «Mi cartera».
  const sbDe = new Map<number, { facturado: number; facturas: number }>();
  for (const v of sb.ventas) {
    if (v.vendedorId === null) continue;
    const t = sbDe.get(v.vendedorId) ?? { facturado: 0, facturas: 0 };
    t.facturado += v.venta;
    sbDe.set(v.vendedorId, t);
  }
  for (const c of compras(sb.ventas)) if (c.vendedorId !== null) sbDe.get(c.vendedorId)!.facturas++;
  const conHistoria = new Set(ventasDeClientes(sb, partners.map((p) => p.id)).keys());

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
      // «Con compra» es haber facturado, no tener saldo: un cliente que paga al
      // contado cuenta igual que uno que debe.
      if ((f && f.facturas > 0) || conHistoria.has(id)) conCompra++;
      if (!f) continue;
      facturado += f.total;
      porCobrar += f.porCobrar;
      facturas += f.facturas;
    }
    facturado += sbDe.get(uid)?.facturado ?? 0;
    facturas += sbDe.get(uid)?.facturas ?? 0;

    return {
      odooUserId: uid,
      nombre: nombrePersona(u?.name ?? v.nombre),
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
