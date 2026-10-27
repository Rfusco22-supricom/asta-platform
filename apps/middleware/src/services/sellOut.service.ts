import ExcelJS from 'exceljs';
import type { ErrorCode, PorMarcar, ReporteSellOut, ResumenSellOut, SellOutEmpresa, TipoSellOut, ValidacionSellOut } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { executeKw, readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheConRefresco } from '../utils/cacheConRefresco.js';
import { MARCA_ASTA } from './asta.service.js';
import { categoriasAsta } from './categoriasAsta.service.js';
import { TIPO_FACTURADO_LINEA, plegarPorTipo } from './criterioFacturacion.js';
import { normalizarRif, rifUtilizable } from './duplicados.js';
import { SIN_INTERCOMPANIA_LINEA } from './intercompania.js';
import { dePantalla, olvidarPantalla } from './pantallas.js';
import { LINEA_ASTA } from './ventasAsta.service.js';

/**
 * Sell-out de los clientes (fase 2): lo que cada cliente vende de ASTA.
 *
 * ── De dónde sale ────────────────────────────────────────────────────────────
 *
 * Supricom solo ve lo que le vende al cliente (sell-in, Odoo). Lo que el
 * cliente vende a los suyos lo reporta él, por mes y producto, subiendo la
 * plantilla del panel (Excel o CSV: código ASTA y cantidad):
 *
 *   · VENTAS      — unidades vendidas en el mes: es lo vendido, tal cual;
 *   · INVENTARIO  — existencia al cierre. Con el de dos meses seguidos,
 *                   vendido(M) = existencia(M−1) + comprado(M) − existencia(M).
 *
 * Si un mes tiene los dos, mandan las ventas.
 *
 * Y una tercera, sin archivo: «Lo que te vendimos». El cliente ve lo que nos
 * compró y marca, producto a producto, cuántas vendió en el mes. Eso es su
 * reporte de VENTAS de ese mes (ver `marcarVendido`).
 *
 * ── Qué se guarda ────────────────────────────────────────────────────────────
 *
 * Un reporte vivo por cliente, mes y tipo. Subir otra vez el mismo mes marca
 * el anterior como reemplazado (`reemplazado_en`): sin DELETE, como el resto
 * de tablas que escribe la aplicación.
 *
 * El cliente es SIEMPRE el del token (ámbito `identidad`).
 */

export class SellOutNoValido extends Error {
  readonly status = 400;
  readonly code: ErrorCode = 'VALIDATION_ERROR';
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'SellOutNoValido';
  }
}

/** Filas como mucho: una tienda tiene unos cientos de productos ASTA. */
export const MAX_FILAS = 2000;
/** Meses hacia atrás que se aceptan. */
export const MESES_ATRAS = 24;
/** Meses que enseña «Mi sell-out». */
export const MESES_RESUMEN = 6;
/** Por debajo de estos días de inventario, «Reponer». */
export const DIAS_REPONER = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Meses
// ─────────────────────────────────────────────────────────────────────────────

export function mesDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 7);
}

/** `mes` ± `n` meses. */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return mesDe(d);
}

function ultimoDia(mes: string): string {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// El catálogo ASTA de Odoo
// ─────────────────────────────────────────────────────────────────────────────

interface ProductoAsta {
  id: number;
  sku: string | null;
  nombre: string;
}

/** «A-W1105A», «a w1105a» y «A-W1105A » son el mismo código. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[\s.]/g, '');
}

const cacheCatalogo = new CacheConRefresco<{ porId: Map<number, ProductoAsta>; porCodigo: Map<string, ProductoAsta> }>(3600_000, 24 * 3600_000, 1);

/** Todos los productos ASTA de Odoo, por id y por código. */
export function catalogoAsta() {
  return cacheCatalogo.obtener('todo', async () => {
    const filas = await searchRead<{ id: number; default_code: string | false; name: string }>(
      'product.product',
      [['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA]],
      ['default_code', 'name'],
      { context: { active_test: false } },
    );
    const porId = new Map<number, ProductoAsta>();
    const porCodigo = new Map<string, ProductoAsta>();
    for (const f of filas) {
      const p = { id: f.id, sku: f.default_code || null, nombre: f.name };
      porId.set(f.id, p);
      if (p.sku) porCodigo.set(normalizarCodigo(p.sku), p);
    }
    return { porId, porCodigo };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Leer el archivo
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaLeida {
  fila: number;
  codigo: string;
  cantidad: unknown;
}

const ES_CODIGO = /c[oó]digo|referencia|sku|ref\b/i;
const ES_CANTIDAD = /cantidad|unidades|existencia|stock|vendid/i;

/** El texto de una celda de exceljs, sea número, texto, fórmula o texto enriquecido. */
function textoDe(valor: ExcelJS.CellValue): unknown {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object') {
    if ('result' in valor) return (valor as { result: unknown }).result ?? '';
    if ('richText' in valor) return (valor as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    if ('text' in valor) return (valor as { text: unknown }).text;
    return '';
  }
  return valor;
}

/** Busca la cabecera (una columna de código y una de cantidad) y lee las filas de debajo. */
function filasDeTabla(tabla: unknown[][]): FilaLeida[] {
  const cab = tabla.findIndex((fila) => fila.some((c) => ES_CODIGO.test(String(c))) && fila.some((c) => ES_CANTIDAD.test(String(c))));
  if (cab < 0) throw new SellOutNoValido('No se encontró la cabecera: hace falta una columna «Código» y otra «Cantidad». Usa la plantilla.');
  const colCodigo = tabla[cab]!.findIndex((c) => ES_CODIGO.test(String(c)));
  const colCantidad = tabla[cab]!.findIndex((c) => ES_CANTIDAD.test(String(c)));
  const filas: FilaLeida[] = [];
  for (let i = cab + 1; i < tabla.length; i++) {
    const codigo = String(tabla[i]![colCodigo] ?? '').trim();
    const cantidad = tabla[i]![colCantidad];
    if (!codigo && (cantidad === '' || cantidad === null || cantidad === undefined)) continue;
    filas.push({ fila: i + 1, codigo, cantidad });
  }
  return filas;
}

/** CSV con «,» o «;» (el Excel en español guarda con «;»). Sin comillas raras: es una plantilla. */
function tablaDeCsv(texto: string): unknown[][] {
  const limpio = texto.replace(/^\uFEFF/, '');
  const lineas = limpio.split(/\r?\n/);
  // Por el archivo entero, no por la primera línea: puede ser un título sin separadores.
  const sep = (limpio.match(/;/g)?.length ?? 0) > (limpio.match(/,/g)?.length ?? 0) ? ';' : ',';
  return lineas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
}

export async function leerArchivo(nombre: string, base64: string): Promise<FilaLeida[]> {
  const datos = Buffer.from(base64, 'base64');
  let tabla: unknown[][];
  if (/\.csv$/i.test(nombre)) {
    tabla = tablaDeCsv(datos.toString('utf8'));
  } else if (/\.xlsx$/i.test(nombre)) {
    const libro = new ExcelJS.Workbook();
    try {
      await libro.xlsx.load(datos as unknown as ArrayBuffer);
    } catch {
      throw new SellOutNoValido('No se pudo abrir el Excel. Guárdalo como .xlsx y vuelve a subirlo.');
    }
    const hoja = libro.worksheets[0];
    if (!hoja) throw new SellOutNoValido('El Excel no tiene ninguna hoja.');
    tabla = [];
    hoja.eachRow({ includeEmpty: true }, (fila, n) => {
      const valores = (fila.values as ExcelJS.CellValue[]).slice(1).map(textoDe);
      tabla[n - 1] = valores;
    });
    for (let i = 0; i < tabla.length; i++) tabla[i] ??= [];
  } else {
    throw new SellOutNoValido('El archivo tiene que ser Excel (.xlsx) o CSV.');
  }
  const filas = filasDeTabla(tabla);
  if (filas.length > MAX_FILAS) throw new SellOutNoValido(`Demasiadas filas: como mucho ${MAX_FILAS}.`);
  return filas;
}

/** «1.234,5», «1234.5», 12 → número. `null` si no lo es. */
export function cantidadDe(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let t = String(valor ?? '').trim();
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprobar y guardar
// ─────────────────────────────────────────────────────────────────────────────

export function comprobarMes(mes: string, hoy = new Date()): void {
  const actual = mesDe(hoy);
  if (mes > actual) throw new SellOutNoValido('Ese mes todavía no ha llegado.');
  if (mes < sumarMeses(actual, -MESES_ATRAS)) throw new SellOutNoValido(`Solo se aceptan los últimos ${MESES_ATRAS} meses.`);
}

interface Comprobado extends ValidacionSellOut {
  lineas: Array<{ productId: number; sku: string; cantidad: number }>;
}

export async function comprobar(partnerId: number, mes: string, tipo: TipoSellOut, nombre: string, archivo: string, hoy = new Date()): Promise<Comprobado> {
  comprobarMes(mes, hoy);
  const filas = await leerArchivo(nombre, archivo);
  const { porCodigo } = await catalogoAsta();
  const errores: Comprobado['errores'] = [];
  const avisos: Comprobado['avisos'] = [];
  const porProducto = new Map<number, { productId: number; sku: string; cantidad: number }>();

  for (const f of filas) {
    if (!f.codigo) {
      errores.push({ fila: f.fila, codigo: '', motivo: 'Falta el código' });
      continue;
    }
    const producto = porCodigo.get(normalizarCodigo(f.codigo));
    if (!producto) {
      errores.push({ fila: f.fila, codigo: f.codigo, motivo: 'No es un código de un producto ASTA' });
      continue;
    }
    const cantidad = cantidadDe(f.cantidad);
    if (cantidad === null) {
      // Sin cantidad, la fila de la plantilla se deja en blanco: se ignora.
      if (String(f.cantidad ?? '').trim() === '') continue;
      errores.push({ fila: f.fila, codigo: f.codigo, motivo: 'La cantidad no es un número' });
      continue;
    }
    if (cantidad < 0) {
      errores.push({ fila: f.fila, codigo: f.codigo, motivo: 'La cantidad no puede ser negativa' });
      continue;
    }
    if (cantidad > 1_000_000) {
      errores.push({ fila: f.fila, codigo: f.codigo, motivo: 'La cantidad es demasiado grande' });
      continue;
    }
    const ya = porProducto.get(producto.id);
    if (ya) {
      ya.cantidad += cantidad;
      avisos.push({ fila: f.fila, codigo: f.codigo, motivo: 'Código repetido: se suma' });
    } else {
      porProducto.set(producto.id, { productId: producto.id, sku: f.codigo.trim().slice(0, 64), cantidad });
    }
  }

  if (errores.length === 0 && porProducto.size === 0) errores.push({ fila: 1, codigo: '', motivo: 'El archivo no trae ninguna cantidad' });

  const reemplaza = (await prisma.sellOutReporte.count({ where: { odooPartnerId: partnerId, mes, tipo, reemplazadoEn: null } })) > 0;
  const lineas = [...porProducto.values()];
  return {
    productos: lineas.length,
    unidades: Math.round(lineas.reduce((s, l) => s + l.cantidad, 0) * 100) / 100,
    errores,
    avisos,
    reemplaza,
    lineas,
  };
}

function aReporte(r: { id: string; mes: string; tipo: TipoSellOut; archivo: string; filas: number; unidades: unknown; createdAt: Date; reemplazadoEn: Date | null }): ReporteSellOut {
  return {
    id: r.id,
    mes: r.mes,
    tipo: r.tipo,
    archivo: r.archivo,
    filas: r.filas,
    unidades: Number(r.unidades),
    subidoEn: r.createdAt.toISOString(),
    vigente: r.reemplazadoEn === null,
  };
}

/** Comprueba y, si no hay errores, guarda. Si hay errores, no guarda nada. */
export async function guardar(
  partnerId: number,
  subidoPor: string,
  datos: { mes: string; tipo: TipoSellOut; nombre: string; archivo: string },
  hoy = new Date(),
): Promise<{ validacion: ValidacionSellOut; reporte: ReporteSellOut | null }> {
  const c = await comprobar(partnerId, datos.mes, datos.tipo, datos.nombre, datos.archivo, hoy);
  const { lineas, ...validacion } = c;
  if (c.errores.length > 0) return { validacion, reporte: null };

  const r = await prisma.$transaction(async (tx) => {
    await tx.sellOutReporte.updateMany({
      where: { odooPartnerId: partnerId, mes: datos.mes, tipo: datos.tipo, reemplazadoEn: null },
      data: { reemplazadoEn: hoy },
    });
    return tx.sellOutReporte.create({
      data: {
        odooPartnerId: partnerId,
        mes: datos.mes,
        tipo: datos.tipo,
        archivo: datos.nombre.slice(0, 200),
        filas: lineas.length,
        unidades: c.unidades,
        subidoPor,
        createdAt: hoy,
        lineas: { create: lineas.map((l) => ({ odooProductId: l.productId, sku: l.sku, cantidad: l.cantidad })) },
      },
    });
  });
  olvidarPantalla(`cliente:${partnerId}:sellout`);
  return { validacion, reporte: aReporte(r) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que compró a Supricom, por producto y mes
// ─────────────────────────────────────────────────────────────────────────────

/** mes → (productId → unidades), neto de devoluciones. Un `read_group` por mes. */
async function compradoPorMes(partnerId: number, meses: string[]): Promise<Map<string, Map<number, number>>> {
  const familia = await executeKw<number[]>('res.partner', 'search', [[['id', 'child_of', partnerId]]], { context: { active_test: false } });
  const base: OdooDomain = [
    ['parent_state', '=', 'posted'],
    TIPO_FACTURADO_LINEA,
    ['partner_id', 'in', familia],
    ['display_type', '=', 'product'],
    LINEA_ASTA,
    SIN_INTERCOMPANIA_LINEA,
  ];
  const porMes = await Promise.all(
    meses.map((mes) =>
      readGroup<{ product_id: [number, string] | false; move_type: string; quantity: number; __count: number }>(
        'account.move.line',
        [...base, ['invoice_date', '>=', `${mes}-01`], ['invoice_date', '<=', ultimoDia(mes)]],
        ['quantity:sum'],
        ['product_id', 'move_type'],
      ),
    ),
  );
  return new Map(
    meses.map((mes, i) => [
      mes,
      new Map(
        [...plegarPorTipo(porMes[i]!, (g) => (g.product_id ? g.product_id[0] : null), ['quantity'], { firmar: true })].map(([id, p]) => [
          id,
          p.sumas.quantity,
        ]),
      ),
    ]),
  );
}

/** Los productos ASTA que el cliente compró en los últimos 12 meses: con ellos se rellena la plantilla. */
async function productosComprados(partnerId: number, hoy: Date): Promise<number[]> {
  const familia = await executeKw<number[]>('res.partner', 'search', [[['id', 'child_of', partnerId]]], { context: { active_test: false } });
  const grupos = await readGroup<{ product_id: [number, string] | false; quantity: number }>(
    'account.move.line',
    [
      ['parent_state', '=', 'posted'],
      TIPO_FACTURADO_LINEA,
      ['partner_id', 'in', familia],
      ['display_type', '=', 'product'],
      LINEA_ASTA,
      SIN_INTERCOMPANIA_LINEA,
      ['invoice_date', '>=', `${sumarMeses(mesDe(hoy), -11)}-01`],
    ],
    ['quantity:sum'],
    ['product_id'],
  );
  return grupos
    .filter((g) => g.product_id && g.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity)
    .map((g) => (g.product_id as [number, string])[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// La plantilla
// ─────────────────────────────────────────────────────────────────────────────

/** El Excel para rellenar: código, producto y cantidad, con los productos que compra. */
export async function plantilla(partnerId: number, hoy = new Date()): Promise<Buffer> {
  const [{ porId }, ids] = await Promise.all([catalogoAsta(), productosComprados(partnerId, hoy).catch(() => [] as number[])]);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Sell-out');
  hoja.columns = [
    { header: 'Código', key: 'codigo', width: 22 },
    { header: 'Producto', key: 'producto', width: 56 },
    { header: 'Cantidad', key: 'cantidad', width: 14 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  for (const id of ids) {
    const p = porId.get(id);
    if (p?.sku) hoja.addRow({ codigo: p.sku, producto: p.nombre, cantidad: null });
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// El resumen del cliente
// ─────────────────────────────────────────────────────────────────────────────

type Cantidades = Map<number, number>;

function suma(m: Cantidades | undefined): number {
  let s = 0;
  for (const v of m?.values() ?? []) s += v;
  return Math.round(s * 100) / 100;
}

/** Lo reportado vivo de esos meses: tipo → mes → (productId → cantidad). */
async function reportado(partnerId: number, meses: string[]) {
  const reportes = await prisma.sellOutReporte.findMany({
    where: { odooPartnerId: partnerId, mes: { in: meses }, reemplazadoEn: null },
    select: { mes: true, tipo: true, lineas: { select: { odooProductId: true, cantidad: true } } },
  });
  const de = { VENTAS: new Map<string, Cantidades>(), INVENTARIO: new Map<string, Cantidades>() };
  for (const r of reportes) de[r.tipo].set(r.mes, new Map(r.lineas.map((l) => [l.odooProductId, Number(l.cantidad)])));
  return de;
}

/**
 * Lo vendido de un mes, por producto. Las ventas reportadas mandan; si no hay,
 * del inventario de ese mes y el anterior. `null` si no hay de dónde sacarlo.
 */
function vendidoDelMes(
  mes: string,
  de: Awaited<ReturnType<typeof reportado>>,
  comprado: Map<string, Cantidades>,
): { fuente: 'VENTAS' | 'INVENTARIO'; porProducto: Cantidades } | null {
  const ventas = de.VENTAS.get(mes);
  if (ventas) return { fuente: 'VENTAS', porProducto: ventas };
  const ahora = de.INVENTARIO.get(mes);
  const antes = de.INVENTARIO.get(sumarMeses(mes, -1));
  if (!ahora || !antes) return null;
  const compras = comprado.get(mes) ?? new Map();
  const ids = new Set([...ahora.keys(), ...antes.keys(), ...compras.keys()]);
  const porProducto: Cantidades = new Map();
  for (const id of ids) {
    // Nunca negativo: un conteo de más no es una venta negativa.
    porProducto.set(id, Math.max(0, (antes.get(id) ?? 0) + (compras.get(id) ?? 0) - (ahora.get(id) ?? 0)));
  }
  return { fuente: 'INVENTARIO', porProducto };
}

export async function resumenSellOut(partnerId: number, hoy = new Date()): Promise<ResumenSellOut> {
  return dePantalla(`cliente:${partnerId}:sellout`, async () => {
    const actual = mesDe(hoy);
    const meses = Array.from({ length: MESES_RESUMEN }, (_, i) => sumarMeses(actual, i - MESES_RESUMEN + 1));
    // Uno más por delante: el inventario del mes anterior al primero.
    const conAnterior = [sumarMeses(meses[0]!, -1), ...meses];
    const [de, comprado, { porId }, historial] = await Promise.all([
      reportado(partnerId, conAnterior),
      compradoPorMes(partnerId, meses),
      catalogoAsta(),
      prisma.sellOutReporte.findMany({ where: { odooPartnerId: partnerId }, orderBy: { createdAt: 'desc' }, take: 24 }),
    ]);

    const vendido = new Map(meses.map((m) => [m, vendidoDelMes(m, de, comprado)]));
    const filasMeses = meses.map((m) => ({
      mes: m,
      compradas: suma(comprado.get(m)),
      vendidas: vendido.get(m) ? suma(vendido.get(m)!.porProducto) : null,
      existencia: de.INVENTARIO.has(m) ? suma(de.INVENTARIO.get(m)) : null,
      fuente: vendido.get(m)?.fuente ?? null,
    }));

    // El último mes con algo reportado.
    const mesProductos = [...meses].reverse().find((m) => de.VENTAS.has(m) || de.INVENTARIO.has(m)) ?? null;
    let productos: ResumenSellOut['productos'] = [];
    if (mesProductos) {
      const ventasDe = vendido.get(mesProductos)?.porProducto;
      const existenciaDe = de.INVENTARIO.get(mesProductos);
      const compradoDe = comprado.get(mesProductos) ?? new Map();
      const ids = new Set([...(ventasDe?.keys() ?? []), ...(existenciaDe?.keys() ?? []), ...compradoDe.keys()]);
      productos = [...ids].map((id) => {
        // El ritmo: la media de lo vendido en los meses con dato.
        const conDato = meses.map((m) => vendido.get(m)?.porProducto.get(id)).filter((v): v is number => v !== undefined);
        const media = conDato.length ? conDato.reduce((s, v) => s + v, 0) / conDato.length : null;
        const existencia = existenciaDe ? (existenciaDe.get(id) ?? 0) : null;
        const diasInventario = existencia !== null && media && media > 0 ? Math.round((existencia / media) * 30) : null;
        const p = porId.get(id);
        return {
          productId: id,
          sku: p?.sku ?? null,
          nombre: p?.nombre ?? `Producto #${id}`,
          compradas: compradoDe.get(id) ?? 0,
          vendidas: ventasDe ? (ventasDe.get(id) ?? 0) : null,
          existencia,
          diasInventario,
          reponer: diasInventario !== null && diasInventario < DIAS_REPONER,
        };
      });
      productos.sort((a, b) => (b.vendidas ?? 0) - (a.vendidas ?? 0) || b.compradas - a.compradas);
    }

    return { meses: filasMeses, mesProductos, productos, reportes: historial.map(aReporte) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// «Lo que te vendimos»: marcar lo vendido, producto a producto
// ─────────────────────────────────────────────────────────────────────────────

/** El nombre del reporte que se va llenando al marcar, para distinguirlo de un archivo. */
export const MARCADO_EN_PANEL = 'Marcado en el panel';

/** Lo que le queda se cuenta, como poco, desde hace estos meses. */
const MESES_POR_MARCAR = 3;

/** Se marca el mes en curso o el anterior: lo de antes, con el Excel. */
export function comprobarMesMarcable(mes: string, hoy = new Date()): void {
  const actual = mesDe(hoy);
  if (mes !== actual && mes !== sumarMeses(actual, -1)) throw new SellOutNoValido('Solo se marca lo vendido de este mes o del anterior.');
}

/**
 * Lo que nos compró, lo que ha marcado como vendido y lo que le queda.
 *
 * Lo que le queda = lo que tenía + lo que nos compró − lo que vendió. «Lo que
 * tenía» solo se sabe si subió un conteo de inventario: entonces se cuenta
 * desde ese mes. Si no, desde hace `MESES_POR_MARCAR` meses (o desde su primer
 * reporte, si es anterior), y lo que tuviera de antes no cuenta: no lo sabemos.
 * Todo dentro de los últimos `MESES_RESUMEN` meses.
 */
export async function porMarcar(partnerId: number, mes: string, hoy = new Date()): Promise<PorMarcar> {
  comprobarMesMarcable(mes, hoy);
  const actual = mesDe(hoy);
  const meses = Array.from({ length: MESES_RESUMEN }, (_, i) => sumarMeses(actual, i - MESES_RESUMEN + 1));
  const [de, comprado, { porId }] = await Promise.all([
    reportado(partnerId, [sumarMeses(meses[0]!, -1), ...meses]),
    // Lo comprado no cambia al marcar: se guarda aparte del resumen.
    dePantalla(`cliente:${partnerId}:sellout:comprado:${actual}`, () => compradoPorMes(partnerId, meses)),
    catalogoAsta(),
  ]);

  const inventario = [...meses].reverse().find((m) => de.INVENTARIO.has(m)) ?? null;
  const primero = meses.find((m) => de.VENTAS.has(m) || de.INVENTARIO.has(m));
  const minimo = sumarMeses(actual, -(MESES_POR_MARCAR - 1));
  // Con inventario, desde el mes siguiente al conteo: ese mes ya está en la existencia.
  const desde = inventario ? sumarMeses(inventario, 1) : primero && primero < minimo ? primero : minimo;
  const base = inventario ? de.INVENTARIO.get(inventario)! : new Map<number, number>();

  const compradas = new Map<number, number>();
  const vendidas = new Map<number, number>();
  const sumar = (m: Map<number, number>, id: number, n: number) => m.set(id, (m.get(id) ?? 0) + n);
  for (const m of meses.filter((x) => x >= desde)) {
    for (const [id, n] of comprado.get(m) ?? []) sumar(compradas, id, n);
    for (const [id, n] of vendidoDelMes(m, de, comprado)?.porProducto ?? []) sumar(vendidas, id, n);
  }
  const delMes = de.VENTAS.get(mes);

  const redondo = (n: number) => Math.round(n * 100) / 100;
  const ids = new Set([...base.keys(), ...compradas.keys(), ...vendidas.keys(), ...(delMes?.keys() ?? [])]);
  const productos = [...ids]
    .filter((id) => porId.has(id))
    .map((id) => {
      const p = porId.get(id)!;
      const b = base.get(id) ?? 0;
      const c = compradas.get(id) ?? 0;
      const v = vendidas.get(id) ?? 0;
      return {
        productId: id,
        sku: p.sku,
        nombre: p.nombre,
        base: redondo(b),
        compradas: redondo(c),
        vendidas: redondo(v),
        quedan: redondo(Math.max(0, b + c - v)),
        vendidasMes: redondo(delMes?.get(id) ?? 0),
      };
    })
    // Lo que le queda, primero; lo agotado, al final.
    .filter((p) => p.base > 0 || p.compradas > 0 || p.vendidas > 0)
    .sort((a, b) => Number(b.quedan > 0) - Number(a.quedan > 0) || b.compradas - a.compradas || a.nombre.localeCompare(b.nombre));

  return { mes, desde: inventario ? sumarMeses(inventario, 1) : desde, inventario, productos };
}

/**
 * Guarda cuántas vendió de un producto en el mes (el total del mes, no lo que
 * suma: marcar dos veces lo mismo no lo duplica).
 *
 * Si el reporte de ventas vivo del mes ya es el de marcar, se cambia esa línea:
 * marcar veinte veces no deja veinte reportes en su historial. Si es un Excel,
 * o no hay, se crea uno nuevo con sus líneas y el cambio, y el Excel queda de
 * historial, como cuando se sube otro archivo.
 */
export async function marcarVendido(
  partnerId: number,
  subidoPor: string,
  datos: { mes: string; productId: number; cantidad: number },
  hoy = new Date(),
): Promise<PorMarcar> {
  comprobarMesMarcable(datos.mes, hoy);
  const { porId } = await catalogoAsta();
  const producto = porId.get(datos.productId);
  if (!producto) throw new SellOutNoValido('No es un producto ASTA.');
  const cantidad = Math.round(datos.cantidad * 100) / 100;
  const sku = (producto.sku ?? String(producto.id)).slice(0, 64);

  await prisma.$transaction(async (tx) => {
    const vivo = await tx.sellOutReporte.findFirst({
      where: { odooPartnerId: partnerId, mes: datos.mes, tipo: 'VENTAS', reemplazadoEn: null },
      include: { lineas: true },
    });
    if (vivo && vivo.archivo === MARCADO_EN_PANEL) {
      const linea = vivo.lineas.find((l) => l.odooProductId === datos.productId);
      if (linea) await tx.sellOutLinea.update({ where: { id: linea.id }, data: { cantidad } });
      else await tx.sellOutLinea.create({ data: { reporteId: vivo.id, odooProductId: datos.productId, sku, cantidad } });
      const lineas = await tx.sellOutLinea.findMany({ where: { reporteId: vivo.id }, select: { cantidad: true } });
      await tx.sellOutReporte.update({
        where: { id: vivo.id },
        data: { filas: lineas.filter((l) => Number(l.cantidad) > 0).length, unidades: lineas.reduce((s, l) => s + Number(l.cantidad), 0), subidoPor },
      });
      return;
    }
    const lineas = new Map((vivo?.lineas ?? []).map((l) => [l.odooProductId, { odooProductId: l.odooProductId, sku: l.sku, cantidad: Number(l.cantidad) }]));
    lineas.set(datos.productId, { odooProductId: datos.productId, sku, cantidad });
    if (vivo) await tx.sellOutReporte.update({ where: { id: vivo.id }, data: { reemplazadoEn: hoy } });
    const todas = [...lineas.values()];
    await tx.sellOutReporte.create({
      data: {
        odooPartnerId: partnerId,
        mes: datos.mes,
        tipo: 'VENTAS',
        archivo: MARCADO_EN_PANEL,
        filas: todas.filter((l) => l.cantidad > 0).length,
        unidades: todas.reduce((s, l) => s + l.cantidad, 0),
        subidoPor,
        createdAt: hoy,
        lineas: { create: todas },
      },
    });
  });
  olvidarPantalla(`cliente:${partnerId}:sellout`);
  return porMarcar(partnerId, datos.mes, hoy);
}

// ─────────────────────────────────────────────────────────────────────────────
// La empresa (administrador)
// ─────────────────────────────────────────────────────────────────────────────

/** El sell-out de un mes de todos los clientes que reportan, y quién del programa no. */
export async function sellOutEmpresa(mes: string, hoy = new Date()): Promise<SellOutEmpresa> {
  comprobarMes(mes, hoy);
  const reportes = await prisma.sellOutReporte.findMany({ where: { mes, reemplazadoEn: null }, select: { odooPartnerId: true } });
  const partners = [...new Set(reportes.map((r) => r.odooPartnerId))];

  const [{ porId }, categorias, fichas] = await Promise.all([
    catalogoAsta(),
    dePantalla('admin:asta:categorias', () => categoriasAsta()).catch(() => null),
    partners.length
      ? searchRead<{ id: number; name: string; vat: string | false }>('res.partner', [['id', 'in', partners]], ['name', 'vat'], { context: { active_test: false } })
      : Promise.resolve([]),
  ]);
  const nombre = new Map(fichas.map((f) => [f.id, f.name]));

  // Cada cliente, con su propio cálculo (y su caché).
  const porCliente = await Promise.all(
    partners.map(async (p) => {
      const de = await reportado(p, [sumarMeses(mes, -1), mes]);
      const comprado = await dePantalla(`cliente:${p}:comprado:${mes}`, () => compradoPorMes(p, [mes]));
      return { partnerId: p, de, comprado, vendido: vendidoDelMes(mes, de, comprado) };
    }),
  );

  const productos = new Map<number, { vendidas: number; existencia: number }>();
  for (const c of porCliente) {
    for (const [id, v] of c.vendido?.porProducto ?? []) {
      const p = productos.get(id) ?? { vendidas: 0, existencia: 0 };
      p.vendidas += v;
      productos.set(id, p);
    }
    for (const [id, v] of c.de.INVENTARIO.get(mes) ?? []) {
      const p = productos.get(id) ?? { vendidas: 0, existencia: 0 };
      p.existencia += v;
      productos.set(id, p);
    }
  }

  const clientes = porCliente
    .map((c) => ({
      partnerId: c.partnerId,
      nombre: nombre.get(c.partnerId) ?? `Cliente #${c.partnerId}`,
      compradas: suma(c.comprado.get(mes)),
      vendidas: c.vendido ? suma(c.vendido.porProducto) : null,
      existencia: c.de.INVENTARIO.has(mes) ? suma(c.de.INVENTARIO.get(mes)) : null,
      fuente: c.vendido?.fuente ?? null,
    }))
    .sort((a, b) => (b.vendidas ?? 0) - (a.vendidas ?? 0));

  // Del programa (Bronce y arriba) sin reporte: por su registro o por su RIF.
  const rifs = new Set(fichas.map((f) => normalizarRif(f.vat || null)).filter((r): r is string => rifUtilizable(r)));
  const reportan = new Set(partners);
  const sinReportar = (categorias?.clientes ?? [])
    .filter((c) => c.categoria !== 'GENERAL' && !reportan.has(c.partnerId) && !rifs.has(c.clave))
    .sort((a, b) => b.compraMensual - a.compraMensual)
    .map((c) => ({ partnerId: c.partnerId, nombre: c.nombre, categoria: c.categoria, vendedor: c.vendedor }));

  return {
    mes,
    totales: {
      clientesReportan: clientes.length,
      vendidas: Math.round(clientes.reduce((s, c) => s + (c.vendidas ?? 0), 0) * 100) / 100,
      compradas: Math.round(clientes.reduce((s, c) => s + c.compradas, 0) * 100) / 100,
      existencia: Math.round(clientes.reduce((s, c) => s + (c.existencia ?? 0), 0) * 100) / 100,
    },
    clientes,
    sinReportar,
    productos: [...productos]
      .map(([id, p]) => ({ productId: id, sku: porId.get(id)?.sku ?? null, nombre: porId.get(id)?.nombre ?? `Producto #${id}`, vendidas: Math.round(p.vendidas * 100) / 100, existencia: Math.round(p.existencia * 100) / 100 }))
      .sort((a, b) => b.vendidas - a.vendidas)
      .slice(0, 20),
  };
}
