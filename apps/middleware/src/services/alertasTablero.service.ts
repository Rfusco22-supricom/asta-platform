import {
  SEDES,
  UMBRALES_ALERTAS as U,
  mesesDelTrimestre,
  trimestreDe,
  type AlertaConcentracion,
  type AlertaRitmo,
  type AlertaTendencia,
  type AlertasTablero,
  type ClientePrograma,
  type EstadoAlerta,
  type ProductoEnRiesgo,
  type RitmoVendedor,
  type SemanaTendencia,
} from '@asta/shared-types';
import { readGroup, searchRead } from '../odoo/client.js';
import { MARCA_ASTA } from './asta.service.js';
import { FACTURA } from './criterioFacturacion.js';
import { SIN_INTERCOMPANIA_LINEA_PEDIDO, SIN_INTERCOMPANIA_PEDIDO } from './intercompania.js';
import { dePantalla } from './pantallas.js';
import { clavesDe, evaluarTrimestre } from './programaAsta.service.js';
import { enSede } from './sede.js';
import { LINEAS_ASTA } from './ventasAsta.service.js';

/**
 * Las alertas del tablero de ASTA (ver las reglas y los umbrales en
 * `@asta/shared-types`, `alertasTablero.ts`). Solo ASTA y solo el administrador.
 *
 * ── De dónde sale cada cifra ─────────────────────────────────────────────────
 *
 *   · Ritmo: el objetivo y la ejecución salen del Programa ASTA del trimestre
 *     (`evaluarTrimestre`, la misma evaluación que ve el cliente): los clientes
 *     con nivel, su cuota mensual y lo que llevan comprado este mes.
 *   · Concentración: lo facturado de ASTA en el mes, por cliente (agrupado por
 *     RIF, como el programa) y por referencia.
 *   · Cobertura: de los clientes con nivel, cuántos compraron ASTA en los
 *     últimos `diasActivo` días. Ventana móvil y no el mes: el día 5 casi nadie
 *     ha comprado todavía, y eso no es perder clientes.
 *   · Tendencia: por semanas de lunes a domingo, en hora de Caracas. Lo cotizado
 *     son las líneas ASTA de los pedidos de venta CREADOS esa semana, en
 *     cualquier estado (una cotización cancelada también se emitió); la
 *     conversión, cuántos de esos pedidos ya están confirmados.
 *   · Inventario: el stock libre de cada producto ASTA en el almacén de cada
 *     sede, frente a lo que se vende allí por semana (las últimas
 *     `semanasVenta`, solo facturas: una devolución no es venta).
 *
 * Sin Panamá en lo que se lee de facturas y pedidos (`enSede(null)`).
 *
 * ── Lo que cuesta ────────────────────────────────────────────────────────────
 *
 * El programa ya está guardado por otras pantallas. Lo demás son unas quince
 * lecturas de Odoo en paralelo; el resultado se guarda como cualquier pantalla
 * (`pantallas.ts`).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fechas, en Caracas (UTC−4 todo el año)
// ─────────────────────────────────────────────────────────────────────────────

const CARACAS_MS = 4 * 3_600_000;

/** «2026-10-28», el día que es en Caracas. */
export function hoyEnCaracas(ahora = new Date()): string {
  return new Date(ahora.getTime() - CARACAS_MS).toISOString().slice(0, 10);
}

function aFecha(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d));
}

export function sumarDias(iso: string, n: number): string {
  const f = aFecha(iso);
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
}

/** De lunes a viernes. Los feriados no se descuentan. */
function esHabil(iso: string): boolean {
  const d = aFecha(iso).getUTCDay();
  return d !== 0 && d !== 6;
}

/** Los días hábiles del mes de `hoy`: los que ya pasaron (hoy incluido), todos, y los que quedan. */
export function diasHabiles(hoy: string): AlertaRitmo['diasHabiles'] {
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  let total = 0;
  let transcurridos = 0;
  for (let d = 1; d <= ultimo; d++) {
    const dia = `${hoy.slice(0, 8)}${String(d).padStart(2, '0')}`;
    if (!esHabil(dia)) continue;
    total++;
    if (dia <= hoy) transcurridos++;
  }
  return { transcurridos, total, restantes: total - transcurridos };
}

/** Las últimas `n` semanas completas (lunes a domingo) antes de la de `hoy`, de la más antigua a la más reciente. */
export function semanasCompletas(hoy: string, n: number): Array<{ desde: string; hasta: string }> {
  const lunesDeHoy = sumarDias(hoy, -((aFecha(hoy).getUTCDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => {
    const desde = sumarDias(lunesDeHoy, -7 * (n - i));
    return { desde, hasta: sumarDias(desde, 6) };
  });
}

/** El instante UTC en que empieza un día de Caracas, como lo escribe Odoo: «2026-10-28 04:00:00». */
function inicioEnUtc(dia: string): string {
  return `${dia} 04:00:00`;
}

/**
 * El día de un grupo `campo:day` de `read_group`, por su `__range` (la
 * etiqueta, «20 oct. 2026», depende del idioma). En una fecha con hora el
 * inicio viene en UTC: se pasa a Caracas.
 */
export function diaDelGrupo(grupo: { __range?: Record<string, { from?: string } | undefined> }, campo: string): string | null {
  const desde = grupo.__range?.[`${campo}:day`]?.from;
  if (!desde) return null;
  if (desde.length <= 10) return desde;
  return new Date(new Date(`${desde.replace(' ', 'T')}Z`).getTime() - CARACAS_MS).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Las reglas, sin E/S
// ─────────────────────────────────────────────────────────────────────────────

const redondear = (x: number) => Math.round(x * 100) / 100;

export interface Ritmo {
  estado: EstadoAlerta;
  esperadoAHoy: number;
  proyeccion: number;
  ritmoActual: number;
  ritmoNecesario: number | null;
  aceleracion: number | null;
}

/**
 * La alerta 1 para un objetivo y una ejecución: la proyección lineal por días
 * hábiles frente al objetivo, y cuánto hay que acelerar para llegar.
 */
export function evaluarRitmo(objetivo: number, ejecucion: number, dias: AlertaRitmo['diasHabiles']): Ritmo {
  const ritmoActual = dias.transcurridos > 0 ? ejecucion / dias.transcurridos : 0;
  const proyeccion = dias.transcurridos > 0 ? ritmoActual * dias.total : ejecucion;
  const falta = Math.max(0, objetivo - ejecucion);
  const ritmoNecesario = dias.restantes > 0 ? falta / dias.restantes : null;
  const aceleracion = ritmoNecesario !== null && ritmoActual > 0 && ritmoNecesario > ritmoActual ? ritmoNecesario / ritmoActual - 1 : null;
  let estado: EstadoAlerta = 'ok';
  if (dias.transcurridos < U.diasHabilesMinimos) estado = 'pronto';
  else if (objetivo > 0 && proyeccion < objetivo * U.ritmoMinimo) estado = 'advertencia';
  return {
    estado,
    esperadoAHoy: redondear((objetivo * dias.transcurridos) / dias.total),
    proyeccion: redondear(proyeccion),
    ritmoActual: redondear(ritmoActual),
    ritmoNecesario: ritmoNecesario === null ? null : redondear(ritmoNecesario),
    aceleracion: aceleracion === null ? null : Math.round(aceleracion * 1000) / 1000,
  };
}

/**
 * La parte de lo vendido que se llevan los primeros: los que son MENOS del
 * `concentracionBase` de los que compraron (al menos uno). Lo negativo
 * (devoluciones) no cuenta como comprador.
 */
export function concentracion(importes: number[]): AlertaConcentracion['clientes'] {
  const v = importes.filter((x) => x > 0).sort((a, b) => b - a);
  const total = v.reduce((s, x) => s + x, 0);
  // Redondeado antes del techo: 100 × 0,15 da 15,000000000000002 en coma flotante.
  const primeros = v.length === 0 ? 0 : Math.max(1, Math.ceil(Math.round(v.length * U.concentracionBase * 1e6) / 1e6) - 1);
  const parte = total > 0 ? v.slice(0, primeros).reduce((s, x) => s + x, 0) / total : 0;
  return { base: v.length, primeros, parte: Math.round(parte * 1000) / 1000, dispara: parte > U.concentracionVolumen };
}

/** La última semana frente a la media de las `semanasMedia` anteriores. */
export function caidaFrenteMedia(serie: number[]): AlertaTendencia['entrada'] {
  const ultima = serie.at(-1) ?? 0;
  const previas = serie.slice(-1 - U.semanasMedia, -1);
  const media = previas.length === U.semanasMedia ? previas.reduce((s, x) => s + x, 0) / previas.length : 0;
  const caida = media > 0 ? 1 - ultima / media : null;
  return {
    ultima: redondear(ultima),
    media: redondear(media),
    caida: caida === null ? null : Math.round(caida * 1000) / 1000,
    dispara: caida !== null && caida >= U.caidaEntrada,
  };
}

/** Cuántas veces seguidas, contando desde el final, la serie bajó respecto a la anterior. */
export function caidasSeguidas(serie: Array<number | null>): number {
  let n = 0;
  for (let i = serie.length - 1; i > 0; i--) {
    const a = serie[i - 1];
    const b = serie[i];
    if (a === null || a === undefined || b === null || b === undefined || !(b < a)) break;
    n++;
  }
  return n;
}

const GRAVEDAD: Record<EstadoAlerta, number> = { prioritaria: 3, advertencia: 2, pronto: 1, ok: 0 };

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se lee
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCTO_ASTA: [string, string, unknown] = ['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA];

/** Lo facturado de ASTA entre dos días, agrupado por `campo` de la línea. */
function facturadoPor<T>(desde: string, hasta: string, groupby: string[], extra: Array<[string, string, unknown]> = []) {
  return readGroup<T & { balance: number; quantity: number }>(
    'account.move.line',
    [...LINEAS_ASTA, ...enSede(null), ['invoice_date', '>=', desde], ['invoice_date', '<=', hasta], ...extra],
    ['balance:sum', 'quantity:sum'],
    groupby,
  );
}

/** clave (RIF) → lo comprado, a partir de los grupos por ficha. */
function porClave(grupos: Array<{ partner_id: [number, string] | false; balance: number }>, claves: Map<number, string>): Map<string, number> {
  const r = new Map<string, number>();
  for (const g of grupos) {
    if (!g.partner_id) continue;
    const k = claves.get(g.partner_id[0]) ?? `p${g.partner_id[0]}`;
    r.set(k, (r.get(k) ?? 0) - g.balance);
  }
  return r;
}

/** Semana a semana: lo cotizado, las cotizaciones y las confirmadas, y lo facturado. */
async function semanasDeTendencia(semanas: Array<{ desde: string; hasta: string }>): Promise<SemanaTendencia[]> {
  const desde = semanas[0]!.desde;
  const hasta = semanas.at(-1)!.hasta;
  const creadas: Array<[string, string, unknown]> = [
    ['create_date', '>=', inicioEnUtc(desde)],
    ['create_date', '<', inicioEnUtc(sumarDias(hasta, 1))],
  ];
  const tz = { context: { tz: 'America/Caracas' } };
  const [lineas, pedidos, facturado] = await Promise.all([
    readGroup<{ price_subtotal: number; __range?: Record<string, { from?: string }> }>(
      'sale.order.line',
      [['product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA], ...enSede(null), SIN_INTERCOMPANIA_LINEA_PEDIDO, ...creadas],
      ['price_subtotal:sum'],
      ['create_date:day'],
      tz,
    ),
    readGroup<{ state: string; __count: number; __range?: Record<string, { from?: string }> }>(
      'sale.order',
      [['order_line.product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA], ...enSede(null), SIN_INTERCOMPANIA_PEDIDO, ...creadas],
      ['amount_untaxed:sum'],
      ['create_date:day', 'state'],
      tz,
    ),
    facturadoPor<{ __range?: Record<string, { from?: string }> }>(desde, hasta, ['invoice_date:day']),
  ]);

  const r = semanas.map((s) => ({ ...s, cotizado: 0, cotizaciones: 0, confirmadas: 0, facturado: 0 }));
  const semanaDe = (dia: string | null) => (dia ? r.find((s) => s.desde <= dia && dia <= s.hasta) : undefined);
  for (const g of lineas) {
    const s = semanaDe(diaDelGrupo(g, 'create_date'));
    if (s) s.cotizado += g.price_subtotal;
  }
  for (const g of pedidos) {
    const s = semanaDe(diaDelGrupo(g, 'create_date'));
    if (!s) continue;
    s.cotizaciones += g.__count;
    if (g.state === 'sale' || g.state === 'done') s.confirmadas += g.__count;
  }
  for (const g of facturado) {
    const s = semanaDe(diaDelGrupo(g, 'invoice_date'));
    if (s) s.facturado -= g.balance;
  }
  return r.map((s) => ({
    ...s,
    cotizado: redondear(s.cotizado),
    facturado: redondear(s.facturado),
    conversion: s.cotizaciones > 0 ? Math.round((s.confirmadas / s.cotizaciones) * 1000) / 1000 : null,
  }));
}

interface FilaStock {
  id: number;
  default_code: string | false;
  name: string;
  free_qty: number;
  qty_available: number;
}

/**
 * Los productos ASTA de una sede que se venden y se están quedando sin stock:
 * menos de `semanasStockMinimo` semanas al ritmo de venta, o agotados. Y si
 * además su stock bajó cada una de las últimas `periodosCaida` semanas
 * (`qty_available` con `to_date`, que Odoo calcula desde los movimientos).
 */
async function enRiesgoEnSede(sede: { id: number; nombre: string }, semanas: Array<{ desde: string; hasta: string }>): Promise<ProductoEnRiesgo[]> {
  const [almacen] = await searchRead<{ id: number }>('stock.warehouse', [['company_id', '=', sede.id]], ['id'], {
    limit: 1,
    context: { allowed_company_ids: [sede.id] },
  });
  if (!almacen) return [];
  const contexto = { warehouse: almacen.id, allowed_company_ids: [sede.id] };

  const [productos, vendido] = await Promise.all([
    searchRead<FilaStock>('product.product', [PRODUCTO_ASTA, ['sale_ok', '=', true], ['detailed_type', '=', 'product']], ['default_code', 'name', 'free_qty', 'qty_available'], {
      context: contexto,
    }),
    readGroup<{ product_id: [number, string] | false; quantity: number }>(
      'account.move.line',
      [...LINEAS_ASTA, ['move_id.move_type', '=', FACTURA], ['company_id', '=', sede.id], ['invoice_date', '>=', semanas[0]!.desde], ['invoice_date', '<=', semanas.at(-1)!.hasta]],
      ['quantity:sum'],
      ['product_id'],
    ),
  ]);
  const porSemana = new Map(vendido.flatMap((g) => (g.product_id && g.quantity > 0 ? [[g.product_id[0], g.quantity / semanas.length] as [number, number]] : [])));

  const candidatos = productos.filter((p) => porSemana.has(p.id) && p.free_qty / porSemana.get(p.id)! < U.semanasStockMinimo);
  if (candidatos.length === 0) return [];

  // El stock al cerrar cada una de las últimas semanas: el domingo a medianoche de Caracas.
  const cierres = semanas.slice(-U.periodosCaida).map((s) => `${sumarDias(s.hasta, 1)} 03:59:59`);
  const historia = await Promise.all(
    cierres.map((to_date) =>
      searchRead<{ id: number; qty_available: number }>('product.product', [['id', 'in', candidatos.map((p) => p.id)]], ['qty_available'], {
        context: { ...contexto, to_date },
      }),
    ),
  );
  const antes = historia.map((h) => new Map(h.map((p) => [p.id, p.qty_available])));

  return candidatos.map((p) => {
    const ventaSemanal = porSemana.get(p.id)!;
    const serie = [...antes.map((m) => m.get(p.id) ?? null), p.qty_available];
    return {
      productoId: p.id,
      codigo: p.default_code || null,
      nombre: p.name,
      sede: sede.nombre,
      libre: p.free_qty,
      ventaSemanal: Math.round(ventaSemanal * 10) / 10,
      semanas: Math.max(0, Math.round((p.free_qty / ventaSemanal) * 10) / 10),
      cayendo: caidasSeguidas(serie) >= U.periodosCaida,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Las tres alertas
// ─────────────────────────────────────────────────────────────────────────────

function alertaRitmo(programados: ClientePrograma[], indiceMes: number, mes: string, dias: AlertaRitmo['diasHabiles']): AlertaRitmo {
  const compraDelMes = (c: ClientePrograma) => c.evaluacion.meses[indiceMes]?.compra ?? 0;
  const objetivo = programados.reduce((s, c) => s + c.evaluacion.cuotaMensual, 0);
  const ejecucion = programados.reduce((s, c) => s + compraDelMes(c), 0);

  const porVendedor = new Map<number | null, ClientePrograma[]>();
  for (const c of programados) porVendedor.set(c.vendedorOdooUserId, [...(porVendedor.get(c.vendedorOdooUserId) ?? []), c]);
  const vendedores: RitmoVendedor[] = [...porVendedor].map(([odooUserId, cs]) => {
    const o = cs.reduce((s, c) => s + c.evaluacion.cuotaMensual, 0);
    const e = cs.reduce((s, c) => s + compraDelMes(c), 0);
    const r = evaluarRitmo(o, e, dias);
    return { vendedor: cs[0]!.vendedor, odooUserId, clientes: cs.length, objetivo: redondear(o), ejecucion: redondear(e), proyeccion: r.proyeccion, estado: r.estado };
  });
  // Primero los que van peor: menos proyección frente a su objetivo.
  const cumplimiento = (v: RitmoVendedor) => (v.objetivo > 0 ? v.proyeccion / v.objetivo : 1);
  vendedores.sort((a, b) => GRAVEDAD[b.estado] - GRAVEDAD[a.estado] || cumplimiento(a) - cumplimiento(b));

  return { mes, diasHabiles: dias, objetivo: redondear(objetivo), ejecucion: redondear(ejecucion), clientes: programados.length, vendedores, ...evaluarRitmo(objetivo, ejecucion, dias) };
}

export async function alertasTablero(ahora = new Date()): Promise<AlertasTablero> {
  const hoy = hoyEnCaracas(ahora);
  const mes = hoy.slice(0, 7);
  const trimestre = trimestreDe(hoy);
  const dias = diasHabiles(hoy);
  const pronto = dias.transcurridos < U.diasHabilesMinimos;
  const semanas = semanasCompletas(hoy, U.semanasVenta);
  const desdeActivo = sumarDias(hoy, -(U.diasActivo - 1));

  const [programa, delMes, porProducto, recientes, tendencia, ...enRiesgo] = await Promise.all([
    // La misma clave que `programaEnCurso`: lo comparten el inicio, el programa y esto.
    dePantalla(`programa:${trimestre}`, () => evaluarTrimestre(trimestre, ahora)),
    facturadoPor<{ partner_id: [number, string] | false }>(`${mes}-01`, hoy, ['partner_id']),
    facturadoPor<{ product_id: [number, string] | false }>(`${mes}-01`, hoy, ['product_id']),
    facturadoPor<{ partner_id: [number, string] | false }>(desdeActivo, hoy, ['partner_id']),
    semanasDeTendencia(semanas),
    ...SEDES.map((s) => enRiesgoEnSede(s, semanas)),
  ]);

  const programados = programa.filter((c) => c.evaluacion.nivel !== 'GENERAL');
  const ritmo = alertaRitmo(programados, mesesDelTrimestre(trimestre).indexOf(mes), mes, dias);

  // ── Concentración y cobertura
  const ids = [...delMes, ...recientes].flatMap((g) => (g.partner_id ? [g.partner_id[0]] : []));
  const claves = await clavesDe(ids);
  const delMesPorClave = porClave(delMes, claves);
  const activos = new Set([...porClave(recientes, claves)].filter(([, x]) => x > 0).map(([k]) => k));
  const clientes = concentracion([...delMesPorClave.values()]);
  const catalogo = concentracion(porProducto.map((g) => -g.balance));
  if (pronto) clientes.dispara = catalogo.dispara = false;
  const sinCompra = programados
    .filter((c) => !activos.has(c.clave))
    .sort((a, b) => b.evaluacion.cuotaMensual - a.evaluacion.cuotaMensual || a.nombre.localeCompare(b.nombre))
    .map((c) => ({ partnerId: c.partnerId, nombre: c.nombre, nivel: c.evaluacion.nivel, vendedor: c.vendedor, cuotaMensual: c.evaluacion.cuotaMensual }));
  const cubiertos = programados.length - sinCompra.length;
  const parteCubierta = programados.length > 0 ? cubiertos / programados.length : 1;
  const cobertura = {
    programados: programados.length,
    activos: cubiertos,
    parte: Math.round(parteCubierta * 1000) / 1000,
    dispara: programados.length > 0 && parteCubierta < U.coberturaMinima,
    sinCompra,
  };
  const disparaConcentracion = clientes.dispara || catalogo.dispara || cobertura.dispara;
  const concentracionAlerta: AlertaConcentracion = {
    // La meta va bien y esto no: es justo lo que la meta esconde (ver el anexo).
    estado: disparaConcentracion ? (ritmo.estado === 'ok' ? 'prioritaria' : 'advertencia') : pronto ? 'pronto' : 'ok',
    volumen: redondear(porProducto.reduce((s, g) => s - g.balance, 0)),
    clientes,
    catalogo,
    cobertura,
  };

  // ── Tendencia temprana
  const entrada = caidaFrenteMedia(tendencia.map((s) => s.cotizado));
  const caidas = caidasSeguidas(tendencia.map((s) => s.conversion));
  const productos = enRiesgo.flat().sort((a, b) => a.semanas - b.semanas || b.ventaSemanal - a.ventaSemanal);
  const conversion = { caidasSeguidas: caidas, dispara: caidas >= U.periodosCaida };
  const inventario = { dispara: productos.length > 0, productos };
  const tendenciaAlerta: AlertaTendencia = {
    estado: entrada.dispara || conversion.dispara || inventario.dispara ? 'advertencia' : 'ok',
    semanas: tendencia,
    entrada,
    conversion,
    inventario,
  };

  return { hoy, ritmo, concentracion: concentracionAlerta, tendencia: tendenciaAlerta };
}
