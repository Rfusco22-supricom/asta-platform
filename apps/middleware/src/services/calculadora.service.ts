import type { Calculadora, ParejaCalculadora } from '@asta/shared-types';
import { readGroup, searchRead } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { MARCA_ASTA } from './asta.service.js';
import { TIPO_FACTURADO_LINEA, plegarPorTipo } from './criterioFacturacion.js';
import { CATEGORIA_CONSUMIBLES } from './impulsa/pasaleAAsta.service.js';
import { equivalentesAsta } from './impulsa/equivalentesAsta.js';
import { preciosDe, tarifaDelCliente } from './pricing.service.js';

/**
 * La calculadora de ganancia del cliente (ver `calculadora.ts` en
 * shared-types): las parejas ASTA–original con los precios de su tarifa y lo
 * que suele comprar de cada uno.
 *
 * Las parejas son de todos y se guardan una hora; los precios y las compras
 * son de cada cliente.
 */

type Producto = { id: number; name: string; default_code: string | false; spiff_brand_id?: [number, string] | false };
type Par = { asta: Producto; original: Producto };

const cachePares = new CacheTtl<Par[]>(3600_000, 1);

/** Meses completos con los que se calcula lo que compra al mes. */
const MESES_COMPRA = 3;

async function pares(): Promise<Par[]> {
  const enCache = cachePares.get('todos');
  if (enCache) return enCache;
  const [asta, originales] = await Promise.all([
    searchRead<Producto>('product.product', [['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA], ['sale_ok', '=', true]], ['name', 'default_code']),
    searchRead<Producto>(
      'product.product',
      [['categ_id', 'child_of', CATEGORIA_CONSUMIBLES], ['sale_ok', '=', true], ['product_tmpl_id.spiff_brand_id', '!=', MARCA_ASTA]],
      ['name', 'default_code', 'spiff_brand_id'],
    ),
  ]);
  const r: Par[] = [];
  for (const o of originales) for (const a of equivalentesAsta(o, asta)) r.push({ asta: a, original: o });
  cachePares.set('todos', r);
  return r;
}

/** producto → unidades al mes que compra el cliente (y sus contactos). */
async function compraMensual(partnerId: number, productos: number[], hoy: Date): Promise<Map<number, number>> {
  if (productos.length === 0) return new Map();
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - MESES_COMPRA, 1)).toISOString().slice(0, 10);
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const grupos = await readGroup<{ product_id: [number, string] | false; move_type: string; quantity: number; __count: number }>(
    'account.move.line',
    [['parent_state', '=', 'posted'], TIPO_FACTURADO_LINEA, ['display_type', '=', 'product'], ['partner_id', 'child_of', partnerId], ['product_id', 'in', productos], ['invoice_date', '>=', desde], ['invoice_date', '<=', hasta]],
    ['quantity:sum'],
    ['product_id', 'move_type'],
  );
  const plegado = plegarPorTipo(grupos, (g) => (g.product_id ? g.product_id[0] : null), ['quantity'], { firmar: true });
  return new Map([...plegado].map(([id, p]) => [id, Math.max(0, Math.round((p.sumas.quantity! / MESES_COMPRA) * 10) / 10)]));
}

export async function calculadora(partnerId: number, pricelistIdentidad: number | null, log?: { warn: (o: unknown, m?: string) => void }, hoy = new Date()): Promise<Calculadora> {
  const todos = (await pares()).filter((p) => p.asta.default_code && p.original.default_code);
  const tarifa = await tarifaDelCliente(partnerId, pricelistIdentidad, log);
  const skus = [...new Set(todos.flatMap((p) => [String(p.asta.default_code), String(p.original.default_code)]))];
  const [{ precios }, compras] = await Promise.all([
    preciosDe(tarifa, skus, log),
    compraMensual(partnerId, [...new Set(todos.flatMap((p) => [p.asta.id, p.original.id]))], hoy),
  ]);
  const precio = new Map(precios.map((x) => [x.sku, x.precio]));

  const parejas: ParejaCalculadora[] = [];
  for (const p of todos) {
    const pa = precio.get(String(p.asta.default_code));
    const po = precio.get(String(p.original.default_code));
    if (!pa || !po) continue;
    parejas.push({
      asta: { productId: p.asta.id, sku: String(p.asta.default_code), nombre: p.asta.name, precio: pa },
      original: { productId: p.original.id, sku: String(p.original.default_code), nombre: p.original.name, precio: po, marca: p.original.spiff_brand_id ? p.original.spiff_brand_id[1] : null },
      compraMensualOriginal: compras.get(p.original.id) ?? 0,
      compraMensualAsta: compras.get(p.asta.id) ?? 0,
    });
  }
  parejas.sort((a, b) => Number(b.compraMensualOriginal > 0) - Number(a.compraMensualOriginal > 0) || b.original.precio - b.asta.precio - (a.original.precio - a.asta.precio));
  return { parejas };
}
