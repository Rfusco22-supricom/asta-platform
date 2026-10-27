import {
  ESCALERA,
  EXCEDENTE,
  DIA_LIMITE_SELLOUT,
  PRIMER_TRIMESTRE,
  TOKENS,
  VARIEDAD,
  bajar,
  cuotasDe,
  limpiarEspacios,
  mesesDelTrimestre,
  subir,
  trimestreAnterior,
  type ClaveCategoria,
  type ClientePrograma,
  type EvaluacionTrimestre,
} from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { executeKw, readGroup, searchRead } from '../odoo/client.js';
import { MARCA_ASTA } from './asta.service.js';
import { categoriasAsta } from './categoriasAsta.service.js';
import { normalizarRif, rifUtilizable } from './duplicados.js';
import { LINEAS_ASTA } from './ventasAsta.service.js';

/**
 * El programa de ASTA por trimestres: cómo va cada cliente en un trimestre y
 * el cierre, que fija su nivel y sus tokens. Las reglas, en
 * `@asta/shared-types` (`programaAsta.ts`).
 *
 * ── El nivel de partida ──────────────────────────────────────────────────────
 *
 * El nivel con el que un cliente empieza un trimestre es con el que acabó el
 * anterior (`programa_trimestres.nivel_fin`). En el primer trimestre del
 * programa no hay anterior: es su categoría de antes (#131) el día que empezó,
 * con los cuatro meses completos previos. Si el anterior todavía no se ha
 * cerrado, se usa con el que acabaría.
 *
 * ── Quién entra ──────────────────────────────────────────────────────────────
 *
 * Todo cliente con un nivel por encima de Cliente general (aunque no compre:
 * entonces baja), y todo el que compró ASTA en el trimestre. Agrupados por RIF,
 * como las categorías: el mismo `clave`.
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
 */
export function evaluar(e: EntradaEvaluacion): EvaluacionTrimestre {
  const cuota = cuotasDe(e.nivel);
  const meses = mesesDelTrimestre(e.trimestre);
  const terminado = e.mesesTerminados.every(Boolean);
  const compraTrimestre = redondear(e.compras.reduce((s, x) => s + x, 0));

  const cumpleMinimo = e.compras.map((c, i) => (c >= cuota.mensual ? true : e.mesesTerminados[i] ? false : null));
  const alcanzado = (logrado: boolean) => (logrado ? true : terminado ? false : null);

  const mensual = todos(cumpleMinimo);
  const trimestral = alcanzado(compraTrimestre >= cuota.trimestral);
  const sellout = todos(e.sellout);
  const excedente = alcanzado(compraTrimestre / 3 >= cuota.mensual * EXCEDENTE[e.nivel]);
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
    meses: meses.map((mes, i) => ({ mes, compra: redondear(e.compras[i]!), cumpleMinimo: cumpleMinimo[i]!, sellout: e.sellout[i]! })),
    compraTrimestre,
    obligatorios: { mensual, trimestral, sellout },
    extras: { excedente, racha, variedad },
    referencias: { compradas: e.referenciasCompradas, total: e.referenciasTotal },
    tokens,
    nivelFinal,
    definitiva: terminado && e.sellout.every((s) => s !== null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se lee
// ─────────────────────────────────────────────────────────────────────────────

/** El último instante en que vale el sell-out de un mes: el día `DIA_LIMITE_SELLOUT` del siguiente, a medianoche de Caracas. */
export function limiteSellout(mes: string): Date {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  // Caracas es UTC−4 todo el año: las 00:00 del día siguiente al límite son las 04:00 UTC.
  return new Date(Date.UTC(a, m, DIA_LIMITE_SELLOUT + 1, 4));
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
}

/** Las fichas de Odoo, en lotes, para saber su RIF y su nombre. */
async function fichas(ids: number[]): Promise<Map<number, Ficha>> {
  const r = new Map<number, Ficha>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 1000) {
    const lote = await searchRead<Ficha>('res.partner', [['id', 'in', unicos.slice(i, i + 1000)]], ['name', 'vat'], { context: { active_test: false } });
    for (const f of lote) r.set(f.id, f);
  }
  return r;
}

function claveDe(id: number, ficha: Map<number, Ficha>): string {
  const rif = normalizarRif(ficha.get(id)?.vat || null);
  return rifUtilizable(rif) ? rif! : `p${id}`;
}

/** clave → lo comprado cada mes, y cuánto compró cada ficha (la que más, da nombre). */
async function comprasPorMes(meses: string[]): Promise<Map<number, number>[]> {
  const grupos = await Promise.all(
    meses.map((mes) =>
      readGroup<{ partner_id: [number, string] | false; balance: number }>(
        'account.move.line',
        [...LINEAS_ASTA, ['invoice_date', '>=', `${mes}-01`], ['invoice_date', '<=', finDeMes(mes)]],
        ['balance:sum'],
        ['partner_id'],
      ),
    ),
  );
  return grupos.map((lista) => new Map(lista.flatMap((g) => (g.partner_id ? [[g.partner_id[0], -g.balance] as [number, number]] : []))));
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
  if (trimestre <= PRIMER_TRIMESTRE) {
    const [a, q] = trimestre.split('-Q').map(Number) as [number, number];
    // El día que empezó el trimestre: la ventana son los cuatro meses completos de antes.
    const categorias = await categoriasAsta({ hoy: new Date(Date.UTC(a, (q - 1) * 3, 1, 12)) });
    // Los tres últimos de esos cuatro meses son el trimestre anterior: con ellos, la racha.
    return new Map(
      categorias.clientes.map((c) => [
        c.clave,
        { nivel: c.categoria, sinFallos: c.porMes.slice(-3).every((x) => x >= cuotasDe(c.categoria).mensual), partnerId: c.partnerId },
      ]),
    );
  }
  // El anterior aún no se cerró: con lo que acabaría.
  const previos = await evaluarTrimestre(anterior, hoy);
  return new Map(previos.map((c) => [c.clave, { nivel: c.evaluacion.nivelFinal, sinFallos: c.evaluacion.obligatorios.mensual, partnerId: c.partnerId }]));
}

/**
 * Cómo va cada cliente en `trimestre` a fecha `hoy`: el trimestre en curso, o
 * uno ya terminado (entonces es el cierre que tocaría).
 */
export async function evaluarTrimestre(trimestre: string, hoy = new Date()): Promise<ClientePrograma[]> {
  const meses = mesesDelTrimestre(trimestre);
  const [inicio, compras, refs, total, sellout, saldos] = await Promise.all([
    partida(trimestre, hoy),
    comprasPorMes(meses),
    referenciasCompradas(meses),
    referenciasAsta(),
    selloutEnPlazo(meses),
    prisma.programaTrimestre.groupBy({ by: ['clave'], where: { trimestre: { lt: trimestre } }, _sum: { tokens: true } }),
  ]);

  // El RIF de todas las fichas que aparecen: las que compraron, las que reportaron y las de partida.
  const ids = [...compras.flatMap((m) => [...m.keys()]), ...refs.keys(), ...sellout.keys(), ...[...inicio.values()].map((p) => p.partnerId)];
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

  const claves = new Set([...grupos.keys(), ...[...inicio.entries()].filter(([, p]) => p.nivel !== 'GENERAL').map(([k]) => k)]);
  const clientes: ClientePrograma[] = [];
  for (const clave of claves) {
    const g = grupos.get(clave);
    const p = inicio.get(clave);
    const total3 = g ? g.compras.reduce((s, x) => s + x, 0) : 0;
    // Solo devoluciones, sin nivel: no está en el programa.
    if (!p && total3 <= 0) continue;
    const principal = g && g.porFicha.size ? [...g.porFicha.entries()].sort((a, b) => b[1] - a[1])[0]![0] : p!.partnerId;
    const evaluacion = evaluar({
      trimestre,
      nivel: p?.nivel ?? 'GENERAL',
      compras: g?.compras ?? [0, 0, 0],
      mesesTerminados: terminados,
      sellout: meses.map((m, i) => (g?.sellout.has(m) ? true : plazoVencido[i] ? false : null)) as EntradaEvaluacion['sellout'],
      referenciasCompradas: g?.referencias.size ?? 0,
      referenciasTotal: total,
      anteriorSinFallos: p?.sinFallos ?? null,
    });
    clientes.push({
      clave,
      partnerId: principal,
      nombre: limpiarEspacios(ficha.get(principal)?.name || `Cliente #${principal}`),
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
 * acabó su último trimestre cerrado. Antes del primer cierre, su categoría el
 * día que empezó el programa. Los que no salen aquí son Cliente general.
 */
export async function nivelesActuales(): Promise<Map<string, ClaveCategoria>> {
  const ultimo = await prisma.programaTrimestre.aggregate({ _max: { trimestre: true } });
  if (!ultimo._max.trimestre) {
    const [a, q] = PRIMER_TRIMESTRE.split('-Q').map(Number) as [number, number];
    const categorias = await categoriasAsta({ hoy: new Date(Date.UTC(a, (q - 1) * 3, 1, 12)) });
    return new Map(categorias.clientes.map((c) => [c.clave, c.categoria]));
  }
  const filas = await prisma.programaTrimestre.findMany({ where: { trimestre: ultimo._max.trimestre }, select: { clave: true, nivelFin: true } });
  return new Map(filas.map((f) => [f.clave, f.nivelFin]));
}
