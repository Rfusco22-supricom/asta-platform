import { MESES_OFERTA, PRODUCTOS_OFERTA, VECINOS_OFERTA, type OfertaCliente, type ProductoOferta } from '@asta/shared-types';
import { executeKw, readGroup, searchRead } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { MARCA_ASTA } from './asta.service.js';
import { TIPO_FACTURADO_LINEA, plegarPorTipo } from './criterioFacturacion.js';
import { SIN_INTERCOMPANIA_LINEA } from './intercompania.js';
import { LINEA_ASTA } from './ventasAsta.service.js';

/**
 * La próxima mejor oferta para un cliente (reglas en `@asta/shared-types`,
 * `proximaOferta.ts`): lo que compran de ASTA sus clientes parecidos y él no.
 *
 * Una sola lectura a Odoo para todos: las unidades de ASTA facturadas de los
 * últimos `MESES_OFERTA` meses, por cliente y producto, netas de devoluciones.
 * Se guarda seis horas: comparar clientes no necesita la factura de hace un
 * minuto, y la ficha la pide cada vez que se abre.
 */

/** cliente (el de la factura) → producto → unidades en el periodo. */
export type Compras = Map<number, Map<number, number>>;

const cacheCompras = new CacheTtl<Compras>(6 * 3600_000, 2);
const cacheVendibles = new CacheTtl<Map<number, { sku: string | null; nombre: string }>>(3600_000, 1);

function desdeDe(hoy: Date): string {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - MESES_OFERTA + 1, 1));
  return d.toISOString().slice(0, 10);
}

async function comprasAsta(hoy: Date): Promise<Compras> {
  const desde = desdeDe(hoy);
  const enCache = cacheCompras.get(desde);
  if (enCache) return enCache;
  const grupos = await readGroup<{ partner_id: [number, string] | false; product_id: [number, string] | false; move_type: string; quantity: number; __count: number }>(
    'account.move.line',
    [['parent_state', '=', 'posted'], TIPO_FACTURADO_LINEA, ['display_type', '=', 'product'], LINEA_ASTA, SIN_INTERCOMPANIA_LINEA, ['invoice_date', '>=', desde]],
    ['quantity:sum'],
    ['partner_id', 'product_id', 'move_type'],
  );
  const plegado = plegarPorTipo(grupos, (g) => (g.partner_id && g.product_id ? `${g.partner_id[0]}:${g.product_id[0]}` : null), ['quantity'], { firmar: true });
  const r: Compras = new Map();
  for (const [clave, p] of plegado) {
    if (p.sumas.quantity! <= 0) continue;
    const [cliente, producto] = clave.split(':').map(Number) as [number, number];
    const m = r.get(cliente) ?? new Map<number, number>();
    m.set(producto, p.sumas.quantity!);
    r.set(cliente, m);
  }
  cacheCompras.set(desde, r);
  return r;
}

/** Los productos ASTA que se pueden ofrecer hoy: activos y a la venta. */
async function vendibles(): Promise<Map<number, { sku: string | null; nombre: string }>> {
  const enCache = cacheVendibles.get('asta');
  if (enCache) return enCache;
  const filas = await searchRead<{ id: number; default_code: string | false; name: string }>(
    'product.product',
    [
      ['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA],
      ['sale_ok', '=', true],
    ],
    ['default_code', 'name'],
  );
  const r = new Map(filas.map((f) => [f.id, { sku: f.default_code || null, nombre: f.name }]));
  cacheVendibles.set('asta', r);
  return r;
}

/**
 * La oferta, con los datos ya leídos. Pura: es lo que prueban los tests.
 *
 * @param propios los ids de factura que son de este cliente (él y sus contactos).
 */
export function ofertaPara(propios: Set<number>, compras: Compras, vendible: Set<number>): Omit<OfertaCliente, 'productos'> & { productos: Omit<ProductoOferta, 'sku' | 'nombre'>[] } {
  const suyo = new Set<number>();
  for (const id of propios) for (const p of compras.get(id)?.keys() ?? []) suyo.add(p);
  const otros = [...compras.entries()].filter(([id]) => !propios.has(id));
  const mensual = (u: number) => Math.round((u / MESES_OFERTA) * 10) / 10;

  // Lo que suman los que lo compran: cuántos son y cuánto compran al mes de media.
  const resumen = (quienes: Array<Map<number, number>>, producto: number) => {
    const compran = quienes.filter((m) => m.has(producto));
    const unidades = compran.reduce((s, m) => s + m.get(producto)!, 0);
    return { clientes: compran.length, unidadesMes: compran.length ? mensual(unidades / compran.length) : 0 };
  };

  if (suyo.size === 0) {
    const porProducto = new Map<number, number>();
    for (const [, m] of otros) for (const p of m.keys()) if (vendible.has(p)) porProducto.set(p, (porProducto.get(p) ?? 0) + 1);
    const top = [...porProducto.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, PRODUCTOS_OFERTA);
    const todos = otros.map(([, m]) => m);
    return { basadoEn: 'MAS_VENDIDOS', comparadoCon: otros.length, compraAsta: 0, productos: top.map(([p]) => ({ productId: p, ...resumen(todos, p) })) };
  }

  const vecinos = otros
    .map(([id, m]) => {
      let comunes = 0;
      for (const p of m.keys()) if (suyo.has(p)) comunes++;
      return { id, m, similitud: comunes === 0 ? 0 : comunes / Math.sqrt(suyo.size * m.size) };
    })
    .filter((v) => v.similitud > 0)
    .sort((a, b) => b.similitud - a.similitud || a.id - b.id)
    .slice(0, VECINOS_OFERTA);

  const puntos = new Map<number, number>();
  for (const v of vecinos) for (const p of v.m.keys()) if (!suyo.has(p) && vendible.has(p)) puntos.set(p, (puntos.get(p) ?? 0) + v.similitud);
  const top = [...puntos.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, PRODUCTOS_OFERTA);
  const deVecinos = vecinos.map((v) => v.m);
  return { basadoEn: 'PARECIDOS', comparadoCon: vecinos.length, compraAsta: suyo.size, productos: top.map(([p]) => ({ productId: p, ...resumen(deVecinos, p) })) };
}

export async function proximaOferta(partnerId: number, hoy = new Date()): Promise<OfertaCliente> {
  const [compras, vendible, familia] = await Promise.all([
    comprasAsta(hoy),
    vendibles(),
    executeKw<number[]>('res.partner', 'search', [[['id', 'child_of', partnerId]]], { context: { active_test: false } }),
  ]);
  const r = ofertaPara(new Set(familia), compras, new Set(vendible.keys()));
  return { ...r, productos: r.productos.map((p) => ({ ...p, sku: vendible.get(p.productId)?.sku ?? null, nombre: vendible.get(p.productId)?.nombre ?? `Producto #${p.productId}` })) };
}
