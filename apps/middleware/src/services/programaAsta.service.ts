import {
  ESCALERA,
  EXCEDENTE,
  PRIMER_TRIMESTRE,
  TOKENS,
  VARIEDAD,
  bajar,
  cuotasDe,
  limpiarEspacios,
  mesesDelTrimestre,
  nombrePersona,
  subir,
  topar,
  trimestreAnterior,
  trimestreDe,
  clientTierSchema,
  type CategoriasAsta,
  type ClaveCategoria,
  type ClientePrograma,
  type EvaluacionTrimestre,
} from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { executeKw, readGroup, searchRead } from '../odoo/client.js';
import { MARCA_ASTA } from './asta.service.js';
import { categoriasAsta } from './categoriasAsta.service.js';
import { normalizarRif, rifUtilizable } from './duplicados.js';
import { dePantalla } from './pantallas.js';
import { enPeriodoDeLaFactura } from './criterioFacturacion.js';
import { LINEAS_ASTA } from './ventasAsta.service.js';

/**
 * El programa de ASTA por trimestres: cómo va cada cliente en un trimestre y
 * el cierre, que fija su nivel y sus tokens. Las reglas, en
 * `@asta/shared-types` (`programaAsta.ts`).
 *
 * ── El nivel de partida ──────────────────────────────────────────────────────
 *
 * El nivel con el que un cliente empieza un trimestre es con el que acabó el
 * anterior (`programa_trimestres.nivel_fin`). Si el anterior todavía no se ha
 * cerrado, se usa con el que acabaría. Quien entra al programa en el trimestre
 * —y todos en el primero, que no tiene anterior— empieza en Cliente general.
 *
 * ── Quién entra (2026-11-20) ─────────────────────────────────────────────────
 *
 * Solo los clientes con acceso al panel: las cuentas de cliente activas que ya
 * entraron alguna vez (`app_users.primer_acceso_at`). Llevar el nivel de quien
 * no puede verlo no tiene sentido. Su programa empieza el mes de su primer
 * acceso (hora de Caracas): ese trimestre se le mira solo desde ese mes
 * (`evaluar`, `desde`). Agrupados por RIF, como las categorías: el mismo
 * `clave`; si varias cuentas comparten RIF, cuenta la que entró primero.
 */

/** Qué hace falta para evaluar a un cliente: lo que se lee de Odoo y de la base. */
export interface EntradaEvaluacion {
  trimestre: string;
  nivel: ClaveCategoria;
  /** Lo comprado de ASTA cada mes del trimestre, en USD sin IVA. */
  compras: [number, number, number];
  /** Si el mes ya terminó. */
  mesesTerminados: [boolean, boolean, boolean];
  /** Si reportó el sell-out del mes dentro de plazo; `null` si no reportó y el plazo sigue abierto. */
  sellout: [boolean | null, boolean | null, boolean | null];
  referenciasCompradas: number;
  referenciasTotal: number;
  /** El trimestre anterior cumplió la cuota mensual los tres meses. `null` si no se sabe. */
  anteriorSinFallos: boolean | null;
  /**
   * Desde qué mes del trimestre (0, 1 o 2) está en el programa: el de su primer
   * acceso al panel, si fue en este trimestre. Los meses de antes no cuentan.
   */
  desde?: number;
}

const redondear = (x: number) => Math.round(x * 100) / 100;

/** Todos `true` → `true`; alguno `false` → `false`; si no, todavía no se sabe. */
function todos(xs: Array<boolean | null>): boolean | null {
  if (xs.some((x) => x === false)) return false;
  return xs.every((x) => x === true) ? true : null;
}

/**
 * La evaluación de un cliente en un trimestre. Sin E/S: todo lo que hace falta
 * viene en `e`, para poder probar las reglas solas.
 *
 * Mientras el trimestre está abierto, lo que aún puede cambiar es `null`. Lo
 * que ya se alcanzó no vuelve atrás: quien pasó el mínimo de un mes a mitad de
 * mes ya lo cumple. El nivel con el que acabaría trata lo pendiente como no
 * cumplido: es lo que pasaría si el trimestre cerrara hoy.
 *
 * Con `desde`, los meses de antes de entrar al programa no se piden: compra 0,
 * ni cumplen ni fallan, y la cuota trimestral es la mensual por los meses que
 * quedan.
 */
export function evaluar(e: EntradaEvaluacion): EvaluacionTrimestre {
  const desde = Math.min(Math.max(e.desde ?? 0, 0), 2);
  const enPrograma = [0, 1, 2].map((i) => i >= desde);
  const activos = <T>(xs: T[]) => xs.filter((_, i) => enPrograma[i]);
  const cuota = cuotasDe(e.nivel, 3 - desde);
  const meses = mesesDelTrimestre(e.trimestre);
  const terminado = e.mesesTerminados.every(Boolean);
  const compras = e.compras.map((c, i) => (enPrograma[i] ? c : 0));
  const sellouts = e.sellout.map((x, i) => (enPrograma[i] ? x : null));
  const compraTrimestre = redondear(compras.reduce((s, x) => s + x, 0));

  const cumpleMinimo = compras.map((c, i) => (!enPrograma[i] ? null : c >= cuota.mensual ? true : e.mesesTerminados[i] ? false : null));
  const alcanzado = (logrado: boolean) => (logrado ? true : terminado ? false : null);

  const mensual = todos(activos(cumpleMinimo));
  const trimestral = alcanzado(compraTrimestre >= cuota.trimestral);
  const sellout = todos(activos(sellouts));
  const excedente = alcanzado(compraTrimestre / (3 - desde) >= cuota.mensual * EXCEDENTE[e.nivel]);
  const racha = mensual === false || e.anteriorSinFallos === false ? false : mensual === true && e.anteriorSinFallos === true ? true : null;
  const variedad = alcanzado(e.referenciasTotal > 0 && e.referenciasCompradas >= Math.ceil(e.referenciasTotal * VARIEDAD));

  const ganados = { mensual, trimestral, sellout, excedente, racha, variedad };
  const tokens = (Object.keys(TOKENS) as Array<keyof typeof TOKENS>).reduce((s, k) => s + (ganados[k] === true ? TOKENS[k] : 0), 0);
  const nivelFinal = mensual === true && trimestral === true && sellout === true ? subir(e.nivel) : bajar(e.nivel);

  return {
    trimestre: e.trimestre,
    nivel: e.nivel,
    cuotaMensual: cuota.mensual,
    cuotaTrimestral: cuota.trimestral,
    meses: meses.map((mes, i) => ({ mes, compra: redondear(compras[i]!), cumpleMinimo: cumpleMinimo[i]!, sellout: sellouts[i]!, enPrograma: enPrograma[i]! })),
    compraTrimestre,
    obligatorios: { mensual, trimestral, sellout },
    extras: { excedente, racha, variedad },
    referencias: { compradas: e.referenciasCompradas, total: e.referenciasTotal },
    tokens,
    nivelFinal,
    definitiva: terminado && activos(sellouts).every((s) => s !== null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se lee
// ─────────────────────────────────────────────────────────────────────────────

/** El último instante en que vale el sell-out de un mes: el final de su último día, hora de Caracas. */
export function limiteSellout(mes: string): Date {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  // Caracas es UTC−4 todo el año: las 00:00 del día 1 del mes siguiente son las 04:00 UTC.
  return new Date(Date.UTC(a, m, 1, 4));
}

function finDeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** El primer día del mes siguiente: el mes terminó si `hoy` ya llegó ahí. */
function terminoElMes(mes: string, hoy: Date): boolean {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return hoy.getTime() >= Date.UTC(a, m, 1, 4);
}

interface Ficha {
  id: number;
  name: string | false;
  vat: string | false;
  user_id: [number, string] | false;
}

/** Las fichas de Odoo, en lotes, para saber su RIF y su nombre. */
async function fichas(ids: number[]): Promise<Map<number, Ficha>> {
  const r = new Map<number, Ficha>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 1000) {
    const lote = await searchRead<Ficha>('res.partner', [['id', 'in', unicos.slice(i, i + 1000)]], ['name', 'vat', 'user_id'], { context: { active_test: false } });
    for (const f of lote) r.set(f.id, f);
  }
  return r;
}

function claveDe(id: number, ficha: Map<number, Ficha>): string {
  const rif = normalizarRif(ficha.get(id)?.vat || null);
  return rifUtilizable(rif) ? rif! : `p${id}`;
}

/** La clave de cada ficha: su RIF, o la propia ficha. La misma con la que se agrupa el programa. */
export async function clavesDe(ids: number[]): Promise<Map<number, string>> {
  const ficha = await fichas(ids);
  return new Map([...new Set(ids)].map((id) => [id, claveDe(id, ficha)]));
}

/** Lo que un cliente (su grupo por RIF) compró de ASTA en un mes. */
export interface CompraDelMes {
  clave: string;
  /** La ficha que más compró del grupo. */
  partnerId: number;
  nombre: string;
  vendedor: string | null;
  vendedorOdooUserId: number | null;
  compra: number;
}

/**
 * Lo comprado de ASTA en `mes` por TODOS los clientes, estén o no en el
 * programa, con el mismo criterio que el programa (`comprasPorMes`). Para el
 * ritmo del mes de las alertas.
 */
export async function comprasDelMesPorCliente(mes: string): Promise<CompraDelMes[]> {
  const [porFicha] = await comprasPorMes([mes]);
  const ficha = await fichas([...porFicha!.keys()]);
  const grupos = new Map<string, Map<number, number>>();
  for (const [id, monto] of porFicha!) {
    const k = claveDe(id, ficha);
    grupos.set(k, (grupos.get(k) ?? new Map()).set(id, monto));
  }
  return [...grupos].map(([clave, deFicha]) => {
    const principal = [...deFicha].sort((a, b) => b[1] - a[1])[0]![0];
    const f = ficha.get(principal);
    return {
      clave,
      partnerId: principal,
      nombre: limpiarEspacios(f?.name || `Cliente #${principal}`),
      vendedor: f?.user_id ? nombrePersona(f.user_id[1]) : null,
      vendedorOdooUserId: f?.user_id ? f.user_id[0] : null,
      compra: redondear([...deFicha.values()].reduce((s, x) => s + x, 0)),
    };
  });
}

/**
 * ficha → lo comprado cada mes. Una nota de crédito resta en el mes de la
 * factura que corrige (`enPeriodoDeLaFactura`): devolver en noviembre algo de
 * octubre no deja noviembre en negativo.
 */
async function comprasPorMes(meses: string[]): Promise<Map<number, number>[]> {
  const grupos = await Promise.all(
    meses.map((mes) =>
      readGroup<{ partner_id: [number, string] | false; balance: number }>(
        'account.move.line',
        [...LINEAS_ASTA, ...enPeriodoDeLaFactura(`${mes}-01`, finDeMes(mes))],
        ['balance:sum'],
        ['partner_id'],
      ),
    ),
  );
  return grupos.map((lista) => new Map(lista.flatMap((g) => (g.partner_id ? [[g.partner_id[0], -g.balance || 0] as [number, number]] : []))));
}

/** ficha → productos ASTA distintos que compró en el trimestre (neto de devoluciones). */
async function referenciasCompradas(meses: string[]): Promise<Map<number, Set<number>>> {
  const grupos = await readGroup<{ partner_id: [number, string] | false; product_id: [number, string] | false; quantity: number }>(
    'account.move.line',
    [...LINEAS_ASTA, ['invoice_date', '>=', `${meses[0]}-01`], ['invoice_date', '<=', finDeMes(meses.at(-1)!)]],
    ['quantity:sum'],
    ['partner_id', 'product_id'],
  );
  const r = new Map<number, Set<number>>();
  for (const g of grupos) {
    if (!g.partner_id || !g.product_id || g.quantity <= 0) continue;
    const s = r.get(g.partner_id[0]) ?? new Set<number>();
    s.add(g.product_id[0]);
    r.set(g.partner_id[0], s);
  }
  return r;
}

/** Las referencias ASTA que vendemos: los productos activos de la marca. */
async function referenciasAsta(): Promise<number> {
  return executeKw<number>('product.product', 'search_count', [[['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA], ['sale_ok', '=', true]]]);
}

/** ficha → meses del trimestre con sell-out reportado dentro de plazo. */
async function selloutEnPlazo(meses: string[]): Promise<Map<number, Set<string>>> {
  const reportes = await prisma.sellOutReporte.findMany({
    where: { mes: { in: meses } },
    select: { odooPartnerId: true, mes: true, createdAt: true },
  });
  const r = new Map<number, Set<string>>();
  for (const x of reportes) {
    if (x.createdAt > limiteSellout(x.mes)) continue;
    const s = r.get(x.odooPartnerId) ?? new Set<string>();
    s.add(x.mes);
    r.set(x.odooPartnerId, s);
  }
  return r;
}

/** Un cliente del programa: el mes en que entró (el de su primer acceso) y su ficha. */
export interface Miembro {
  /** «AAAA-MM», en hora de Caracas. */
  desde: string;
  partnerId: number;
}

/** «AAAA-MM» de un instante, en Caracas (UTC−4 todo el año). */
function mesEnCaracas(d: Date): string {
  return new Date(d.getTime() - 4 * 3_600_000).toISOString().slice(0, 7);
}

/**
 * Quién está en el programa antes de `hasta`: las cuentas de cliente activas que
 * ya entraron al panel. Por RIF (o la ficha comercial sin RIF utilizable, como
 * las cuentas en `aplicarNiveles`); de un grupo, la cuenta que entró primero.
 */
export async function miembrosDelPrograma(hasta: Date): Promise<Map<string, Miembro>> {
  const cuentas = await prisma.appUser.findMany({
    where: { role: { in: clientTierSchema.options }, isActive: true, primerAccesoAt: { not: null, lt: hasta } },
    select: { odooPartnerId: true, primerAccesoAt: true },
  });
  if (cuentas.length === 0) return new Map();
  const ficha = new Map(
    (
      await searchRead<{ id: number; vat: string | false; commercial_partner_id: [number, string] | false }>(
        'res.partner',
        [['id', 'in', [...new Set(cuentas.map((c) => c.odooPartnerId))]]],
        ['vat', 'commercial_partner_id'],
        { context: { active_test: false } },
      )
    ).map((f) => [f.id, f]),
  );
  const r = new Map<string, Miembro>();
  for (const c of cuentas) {
    const f = ficha.get(c.odooPartnerId);
    const rif = normalizarRif(f?.vat || null);
    const clave = rifUtilizable(rif) ? rif! : `p${f?.commercial_partner_id ? f.commercial_partner_id[0] : c.odooPartnerId}`;
    const desde = mesEnCaracas(c.primerAccesoAt!);
    const ya = r.get(clave);
    if (!ya || desde < ya.desde) r.set(clave, { desde, partnerId: c.odooPartnerId });
  }
  return r;
}

interface Partida {
  nivel: ClaveCategoria;
  /** Si el trimestre anterior cumplió la cuota mensual los tres meses, si se sabe. */
  sinFallos: boolean | null;
  partnerId: number;
}

/**
 * El nivel con el que cada cliente empieza `trimestre`. Ver la cabecera.
 * Devuelve solo los que tienen algo: los que faltan empiezan en Cliente general.
 */
async function partida(trimestre: string, hoy: Date): Promise<Map<string, Partida>> {
  const anterior = trimestreAnterior(trimestre);
  const cerrados = await prisma.programaTrimestre.findMany({ where: { trimestre: anterior } });
  if (cerrados.length > 0) {
    return new Map(cerrados.map((c) => [c.clave, { nivel: c.nivelFin, sinFallos: c.cumpleMensual, partnerId: c.odooPartnerId }]));
  }
  // El primero no tiene anterior: todos empiezan en Cliente general.
  if (trimestre <= PRIMER_TRIMESTRE) return new Map();
  // El anterior aún no se cerró: con lo que acabaría.
  const previos = await evaluarTrimestre(anterior, hoy);
  return new Map(previos.map((c) => [c.clave, { nivel: c.evaluacion.nivelFinal, sinFallos: c.evaluacion.obligatorios.mensual, partnerId: c.partnerId }]));
}

/**
 * Cómo va cada cliente en `trimestre` a fecha `hoy`: el trimestre en curso, o
 * uno ya terminado (entonces es el cierre que tocaría).
 */
export async function evaluarTrimestre(trimestre: string, hoy = new Date(), opciones: { miembros?: Map<string, Miembro> } = {}): Promise<ClientePrograma[]> {
  const meses = mesesDelTrimestre(trimestre);
  const [miembros, inicio, compras, refs, total, sellout, saldos] = await Promise.all([
    opciones.miembros ?? miembrosDelPrograma(limiteSellout(meses[2])),
    partida(trimestre, hoy),
    comprasPorMes(meses),
    referenciasCompradas(meses),
    referenciasAsta(),
    selloutEnPlazo(meses),
    prisma.programaTrimestre.groupBy({ by: ['clave'], where: { trimestre: { lt: trimestre } }, _sum: { tokens: true } }),
  ]);

  // El RIF de todas las fichas que aparecen: las que compraron, las que reportaron y las de partida.
  const ids = [...compras.flatMap((m) => [...m.keys()]), ...refs.keys(), ...sellout.keys(), ...[...miembros.values()].map((m) => m.partnerId)];
  const ficha = await fichas(ids);

  interface Acumulado {
    compras: [number, number, number];
    porFicha: Map<number, number>;
    referencias: Set<number>;
    sellout: Set<string>;
  }
  const grupos = new Map<string, Acumulado>();
  const grupo = (id: number) => {
    const k = claveDe(id, ficha);
    const g = grupos.get(k) ?? { compras: [0, 0, 0], porFicha: new Map(), referencias: new Set(), sellout: new Set() };
    grupos.set(k, g);
    return g;
  };
  compras.forEach((m, i) => {
    for (const [id, monto] of m) {
      const g = grupo(id);
      g.compras[i] += monto;
      g.porFicha.set(id, (g.porFicha.get(id) ?? 0) + monto);
    }
  });
  for (const [id, productos] of refs) for (const p of productos) grupo(id).referencias.add(p);
  for (const [id, ms] of sellout) for (const m of ms) grupo(id).sellout.add(m);

  const saldo = new Map(saldos.map((s) => [s.clave, s._sum.tokens ?? 0]));
  const terminados = meses.map((m) => terminoElMes(m, hoy)) as [boolean, boolean, boolean];
  const plazoVencido = meses.map((m) => hoy > limiteSellout(m));

  // Solo los que tienen acceso al panel (ver la cabecera): las compras de los demás no se miran.
  const clientes: ClientePrograma[] = [];
  for (const [clave, m] of miembros) {
    const g = grupos.get(clave);
    // Entró en este trimestre: empieza en Cliente general y desde el mes de su primer acceso.
    const nuevo = m.desde >= meses[0];
    const p = nuevo ? undefined : inicio.get(clave);
    const principal = g && g.porFicha.size ? [...g.porFicha.entries()].sort((a, b) => b[1] - a[1])[0]![0] : m.partnerId;
    const evaluacion = evaluar({
      trimestre,
      // Nadie empieza por encima de `NIVEL_MAXIMO` (Diamante, bloqueado).
      nivel: topar(p?.nivel ?? 'GENERAL'),
      compras: g?.compras ?? [0, 0, 0],
      mesesTerminados: terminados,
      sellout: meses.map((mes, i) => (g?.sellout.has(mes) ? true : plazoVencido[i] ? false : null)) as EntradaEvaluacion['sellout'],
      referenciasCompradas: g?.referencias.size ?? 0,
      referenciasTotal: total,
      // Sin trimestre anterior en el programa no hay racha.
      anteriorSinFallos: p?.sinFallos ?? false,
      desde: nuevo ? Math.max(0, meses.indexOf(m.desde)) : 0,
    });
    const f = ficha.get(principal);
    clientes.push({
      clave,
      partnerId: principal,
      nombre: limpiarEspacios(f?.name || `Cliente #${principal}`),
      vendedor: f?.user_id ? nombrePersona(f.user_id[1]) : null,
      vendedorOdooUserId: f?.user_id ? f.user_id[0] : null,
      evaluacion,
      saldoTokens: saldo.get(clave) ?? 0,
    });
  }
  // De nivel más alto a más bajo, y dentro, de más compra a menos.
  return clientes.sort(
    (a, b) => ESCALERA.indexOf(b.evaluacion.nivel) - ESCALERA.indexOf(a.evaluacion.nivel) || b.evaluacion.compraTrimestre - a.evaluacion.compraTrimestre,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// El cierre
// ─────────────────────────────────────────────────────────────────────────────

export class CierreNoPermitido extends Error {
  readonly status = 409;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CierreNoPermitido';
  }
}

export interface ResumenCierre {
  trimestre: string;
  clientes: number;
  suben: number;
  bajan: number;
  seQuedan: number;
  tokens: number;
  /** Cuántos acaban en cada nivel. */
  porNivel: Record<ClaveCategoria, number>;
  /** Cuántos cumplen cada cosa, para revisar el simulacro. */
  cumplen: Record<'mensual' | 'trimestral' | 'sellout' | 'excedente' | 'racha' | 'variedad', number>;
  referenciasTotal: number;
}

/** Cuántos suben, bajan y cumplen cada cosa: lo que enseña el simulacro y el cierre. */
export function resumir(trimestre: string, clientes: ClientePrograma[]): ResumenCierre {
  const indice = (n: ClaveCategoria) => ESCALERA.indexOf(n);
  const r: ResumenCierre = {
    trimestre,
    clientes: clientes.length,
    suben: 0,
    bajan: 0,
    seQuedan: 0,
    tokens: 0,
    porNivel: Object.fromEntries(ESCALERA.map((n) => [n, 0])) as Record<ClaveCategoria, number>,
    cumplen: { mensual: 0, trimestral: 0, sellout: 0, excedente: 0, racha: 0, variedad: 0 },
    referenciasTotal: clientes[0]?.evaluacion.referencias.total ?? 0,
  };
  for (const c of clientes) {
    const e = c.evaluacion;
    const d = indice(e.nivelFinal) - indice(e.nivel);
    if (d > 0) r.suben++;
    else if (d < 0) r.bajan++;
    else r.seQuedan++;
    r.tokens += e.tokens;
    r.porNivel[e.nivelFinal]++;
    for (const k of ['mensual', 'trimestral', 'sellout'] as const) if (e.obligatorios[k]) r.cumplen[k]++;
    for (const k of ['excedente', 'racha', 'variedad'] as const) if (e.extras[k]) r.cumplen[k]++;
  }
  return r;
}

/**
 * Cierra el trimestre: guarda la evaluación de cada cliente, que ya no cambia.
 *
 * Solo cuando es definitiva: el trimestre terminó y venció el plazo del
 * sell-out de su último mes. Una vez por trimestre: si ya se cerró, no hace
 * nada. El nivel de las cuentas lo pone después `aplicarNiveles`, que lee de
 * aquí. `evaluarCon` es para los tests.
 */
export async function cerrarTrimestre(
  trimestre: string,
  opciones: { aplicar: boolean; hoy?: Date; cerradoPor?: string | null; evaluarCon?: (t: string, hoy: Date) => Promise<ClientePrograma[]> },
): Promise<ResumenCierre> {
  const hoy = opciones.hoy ?? new Date();
  const ultimo = mesesDelTrimestre(trimestre)[2];
  if (hoy <= limiteSellout(ultimo)) {
    const dia = limiteSellout(ultimo).toISOString().slice(0, 10);
    throw new CierreNoPermitido(`El trimestre ${trimestre} se puede cerrar desde el ${dia}: hasta entonces se acepta el sell-out de su último mes.`);
  }
  if ((await prisma.programaTrimestre.count({ where: { trimestre } })) > 0) {
    throw new CierreNoPermitido(`El trimestre ${trimestre} ya está cerrado.`);
  }

  const clientes = await (opciones.evaluarCon ?? evaluarTrimestre)(trimestre, hoy);
  const pendiente = clientes.find((c) => !c.evaluacion.definitiva);
  if (pendiente) throw new CierreNoPermitido(`La evaluación de ${pendiente.nombre} todavía puede cambiar: no se cierra.`);
  const r = resumir(trimestre, clientes);

  if (opciones.aplicar) {
    await prisma.programaTrimestre.createMany({
      data: clientes.map((c) => ({
        clave: c.clave,
        odooPartnerId: c.partnerId,
        trimestre,
        nivelInicio: c.evaluacion.nivel,
        nivelFin: c.evaluacion.nivelFinal,
        compra: c.evaluacion.compraTrimestre,
        cumpleMensual: c.evaluacion.obligatorios.mensual === true,
        cumpleTrimestral: c.evaluacion.obligatorios.trimestral === true,
        cumpleSellout: c.evaluacion.obligatorios.sellout === true,
        excedente: c.evaluacion.extras.excedente === true,
        racha: c.evaluacion.extras.racha === true,
        variedad: c.evaluacion.extras.variedad === true,
        tokens: c.evaluacion.tokens,
        cerradoEn: hoy,
        cerradoPor: opciones.cerradoPor ?? null,
      })),
    });
  }
  return r;
}

/**
 * El nivel de cada cliente hoy, para las cuentas (`aplicarNiveles`): con el que
 * acabó su último trimestre cerrado. Antes del primer cierre, todos son Cliente
 * general (el programa empieza ahí). Los que no salen aquí son Cliente general.
 * Nadie pasa de `NIVEL_MAXIMO`: con Diamante bloqueado, quien compra para él es Oro.
 */
export async function nivelesActuales(): Promise<Map<string, ClaveCategoria>> {
  const ultimo = await prisma.programaTrimestre.aggregate({ _max: { trimestre: true } });
  if (!ultimo._max.trimestre) return new Map();
  const filas = await prisma.programaTrimestre.findMany({ where: { trimestre: ultimo._max.trimestre }, select: { clave: true, nivelFin: true } });
  return new Map(filas.map((f) => [f.clave, topar(f.nivelFin)]));
}

/**
 * El programa de UN cliente en el trimestre en curso, para «Mis métricas».
 *
 * Sale de la misma evaluación de todos (`evaluarTrimestre`, guardada un rato):
 * así el cliente ve lo mismo que Supricom. Si no está en ella —todavía no ha
 * entrado al panel, como cuando el administrador mira su panel— se le evalúa
 * como si entrara hoy: Cliente general desde este mes, con cero y con el
 * sell-out que sí haya reportado.
 */
export async function programaDeCliente(partnerId: number, hoy = new Date()): Promise<{ saldoTokens: number; evaluacion: EvaluacionTrimestre }> {
  const trimestre = trimestreDe(hoy);
  const meses = mesesDelTrimestre(trimestre);
  const [todos, [ficha]] = await Promise.all([
    programaEnCurso(hoy),
    searchRead<{ vat: string | false; commercial_partner_id: [number, string] | false }>('res.partner', [['id', 'in', [partnerId]]], ['vat', 'commercial_partner_id'], {
      context: { active_test: false },
    }),
  ]);
  // La misma clave que las cuentas (`claveDeFicha`): el RIF, o la ficha comercial.
  const rif = normalizarRif(ficha?.vat || null);
  const clave = rifUtilizable(rif) ? rif! : `p${ficha?.commercial_partner_id ? ficha.commercial_partner_id[0] : partnerId}`;
  const suyo = todos.find((c) => c.clave === clave);
  if (suyo) return { saldoTokens: suyo.saldoTokens, evaluacion: suyo.evaluacion };

  const [reportes, saldo, total] = await Promise.all([
    prisma.sellOutReporte.findMany({ where: { odooPartnerId: partnerId, mes: { in: meses } }, select: { mes: true, createdAt: true } }),
    prisma.programaTrimestre.aggregate({ where: { clave }, _sum: { tokens: true } }),
    todos[0] ? Promise.resolve(todos[0].evaluacion.referencias.total) : referenciasAsta(),
  ]);
  const enPlazo = new Set(reportes.filter((r) => r.createdAt <= limiteSellout(r.mes)).map((r) => r.mes));
  const evaluacion = evaluar({
    trimestre,
    nivel: 'GENERAL',
    compras: [0, 0, 0],
    mesesTerminados: meses.map((m) => terminoElMes(m, hoy)) as EntradaEvaluacion['mesesTerminados'],
    sellout: meses.map((m) => (enPlazo.has(m) ? true : hoy > limiteSellout(m) ? false : null)) as EntradaEvaluacion['sellout'],
    referenciasCompradas: 0,
    referenciasTotal: total,
    anteriorSinFallos: false,
    desde: Math.max(0, meses.indexOf(mesEnCaracas(hoy))),
  });
  return { saldoTokens: saldo._sum.tokens ?? 0, evaluacion };
}

/** El trimestre en curso de todos, guardado un rato: lo leen el cliente, el administrador y el vendedor. */
export function programaEnCurso(hoy = new Date()): Promise<ClientePrograma[]> {
  const trimestre = trimestreDe(hoy);
  return dePantalla(`programa:${trimestre}`, () => evaluarTrimestre(trimestre, hoy));
}

/**
 * Las categorías de compra (`categoriasAsta`) con el NIVEL del programa: la
 * compra mensual y la meta siguen siendo las de los cuatro meses, pero en qué
 * nivel está cada cliente —y cuántos hay en cada uno— es el del programa. Así
 * la pirámide, la meta y la tabla dicen lo mismo que el cliente ve.
 *
 * Un cliente con nivel que no compró en esos cuatro meses no sale aquí (no
 * aporta a la meta); en la tabla del programa sí.
 */
export async function conNivelesDelPrograma(categorias: CategoriasAsta): Promise<CategoriasAsta> {
  const niveles = await nivelesActuales();
  const clientes = categorias.clientes.map((c) => ({ ...c, categoria: niveles.get(c.clave) ?? ('GENERAL' as const) }));
  const redondo = (x: number) => Math.round(x * 100) / 100;
  return {
    ...categorias,
    clientes,
    porCategoria: categorias.porCategoria.map((p) => {
      const de = clientes.filter((c) => c.categoria === p.categoria);
      return { ...p, clientes: de.length, compraMensual: redondo(de.reduce((s, c) => s + c.compraMensual, 0)) };
    }),
  };
}

/** Las categorías con el nivel del programa, guardadas un rato: las leen la meta, la pirámide y el sell-out. */
export function categoriasDelPrograma(): Promise<CategoriasAsta> {
  return dePantalla('admin:asta:categorias', async () => conNivelesDelPrograma(await categoriasAsta()));
}

