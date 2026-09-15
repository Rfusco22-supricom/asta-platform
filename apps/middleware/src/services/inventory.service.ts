import type { InventoryQuery, PublicInventoryItem, StockStatus } from '@asta/shared-types';
import { executeKw, searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';

/**
 * Existencias del catálogo para la API pública (#30).
 *
 * ── Qué existencia ve un cliente ─────────────────────────────────────────────
 *
 * La del almacén que le vende, y nada más. `qty_available` sin contexto suma los
 * 48 almacenes de las 6 compañías de la instancia: Venezuela y Panamá, y además
 * "Mal Estado", "Exhibición", "Mercancía por Robo", "RMA", "Demo". Un monitor
 * con sus dos únicas unidades en "Mal Estado Exterior" y "Exhibición" salía con
 * existencia 2.
 *
 * Cada compañía vende desde un único almacén, y cada cliente compra solo a la
 * suya. Medido sobre todas las ventas confirmadas de la instancia:
 *
 *   compañía 7  (Supricom, S.A)                 → almacén Central#7    6517 de 6517
 *   compañía 9  (Office Solutions 2004 - B)     → almacén Central#9    3745 de 3745
 *   compañía 10 (Supricom CCS 21 - B)           → almacén Principal#10 3852 de 3852
 *
 * Así que el almacén se resuelve igual que lo resuelve Odoo al crear un pedido
 * de esa compañía: el primero de la compañía en su orden por defecto. Y sale
 * del partner del TOKEN, nunca de la petición — no hay parámetro de almacén.
 *
 * ── Qué número ───────────────────────────────────────────────────────────────
 *
 * `free_qty`: lo físico menos lo reservado para pedidos ya confirmados. Con
 * `qty_available`, un producto con todas sus unidades comprometidas se
 * anunciaría como disponible. Se publica como estado, no como cantidad (#30).
 *
 * Contrastado contra `stock.quant` por otra vía: 0 discrepancias en 300
 * productos. Lo vuelve a comprobar `inventario.test.ts`.
 *
 * ── Qué NUNCA sale de aquí ───────────────────────────────────────────────────
 *
 * Costos ni precios. Los campos que se piden a Odoo son una lista cerrada, y la
 * respuesta se construye campo a campo: aunque alguien añada `standard_price`
 * a la lista, no llega al cliente sin tocar también `aItem`.
 */

/** Campos que se leen de Odoo. Cerrada a propósito: ver arriba. */
const CAMPOS = ['default_code', 'name', 'categ_id', 'product_tmpl_id', 'free_qty'] as const;

interface FilaProducto {
  id: number;
  default_code: string | false;
  name: string;
  categ_id: [number, string] | false;
  product_tmpl_id: [number, string];
  free_qty: number;
}

export interface AlmacenCliente {
  companyId: number;
  warehouseId: number;
}

/**
 * Unidades libres a partir de las cuales el estado deja de ser `bajo`.
 *
 * Getter y no constante, como `UMBRALES` de las alertas: así un test puede
 * cambiarlo sin recargar el módulo.
 */
export function umbralStockBajo(): number {
  const v = Number(process.env.INVENTARIO_UMBRAL_BAJO);
  return Number.isFinite(v) && v > 0 ? v : 5;
}

export function estadoDeStock(libre: number, umbral = umbralStockBajo()): StockStatus {
  if (libre <= 0) return 'agotado';
  if (libre <= umbral) return 'bajo';
  return 'disponible';
}

/** La compañía de un cliente cambia rara vez; 10 min ahorra dos RPC por petición. */
const cacheAlmacen = new CacheTtl<AlmacenCliente | null>(10 * 60_000, 5_000);
/** 60 s, lo que pide #30. La clave lleva el almacén: ver `listarInventario`. */
const cachePaginas = new CacheTtl<{ items: PublicInventoryItem[]; total: number }>(60_000, 1_000);

/** Solo para tests. */
export function vaciarCachesInventario(): void {
  cacheAlmacen.vaciar();
  cachePaginas.vaciar();
}

/**
 * El almacén que vende a un cliente, o `null` si no se puede determinar.
 *
 * Se mira la compañía del partner COMERCIAL, no la del contacto: es la misma
 * raíz que usa `/invoices` con `child_of`. De 364 contactos hijos con compañía,
 * uno la tiene distinta a la de su empresa.
 *
 * `null` —cliente sin compañía, o compañía sin almacén— se trata como un error
 * del controlador, no como "todo agotado": un catálogo entero en `agotado` es
 * una respuesta verosímil y falsa.
 */
export async function almacenDelCliente(partnerId: number): Promise<AlmacenCliente | null> {
  const clave = String(partnerId);
  const enCache = cacheAlmacen.get(clave);
  if (enCache !== undefined) return enCache;

  const [partner] = await searchRead<{ commercial_partner_id: [number, string] | false }>(
    'res.partner',
    [['id', '=', partnerId]],
    ['commercial_partner_id'],
  );
  const raiz = partner?.commercial_partner_id ? partner.commercial_partner_id[0] : partnerId;

  const [comercial] = await searchRead<{ company_id: [number, string] | false }>(
    'res.partner',
    [['id', '=', raiz]],
    ['company_id'],
  );

  let resultado: AlmacenCliente | null = null;
  if (comercial?.company_id) {
    const companyId = comercial.company_id[0];
    const [almacen] = await searchRead<{ id: number }>(
      'stock.warehouse',
      [['company_id', '=', companyId]],
      ['id'],
      { limit: 1, context: { allowed_company_ids: [companyId] } },
    );
    if (almacen) resultado = { companyId, warehouseId: almacen.id };
  }

  cacheAlmacen.set(clave, resultado);
  return resultado;
}

export function dominioInventario(
  consulta: Pick<InventoryQuery, 'sku' | 'q' | 'soloDisponibles'>,
  companyId: number,
): OdooDomain {
  const dominio: OdooDomain = [
    ['sale_ok', '=', true],
    // Solo almacenables: servicios y consumibles no tienen existencia, y
    // publicarlos como "agotado" sería mentir.
    ['detailed_type', '=', 'product'],
    // Hoy ningún producto tiene compañía. Si alguno la tuviera, otro cliente no
    // debe verlo: el catálogo global no es excusa para filtrar productos ajenos.
    ['company_id', 'in', [false, companyId]],
  ];
  if (consulta.sku) dominio.push(['default_code', '=', consulta.sku]);
  if (consulta.q) dominio.push('|', ['name', 'ilike', consulta.q], ['default_code', 'ilike', consulta.q]);
  if (consulta.soloDisponibles) dominio.push(['free_qty', '>', 0]);
  return dominio;
}

function aItem(fila: FilaProducto): PublicInventoryItem {
  return {
    id: fila.id,
    templateId: fila.product_tmpl_id[0],
    sku: fila.default_code || null,
    nombre: fila.name,
    categoria: fila.categ_id ? fila.categ_id[1] : null,
    stock: estadoDeStock(fila.free_qty),
  };
}

export interface PaginaInventario {
  items: PublicInventoryItem[];
  total: number;
  desdeCache: boolean;
}

/**
 * Una página del inventario vista desde un almacén.
 *
 * La clave de cache lleva el almacén. Sin él, el primer cliente que pide una
 * búsqueda fija la existencia que ven durante 60 s todos los demás, también los
 * de otro país. Es la fuga que prueba `inventario.test.ts` pidiendo lo mismo con
 * dos keys seguidas.
 */
export async function listarInventario(
  almacen: AlmacenCliente,
  consulta: Pick<InventoryQuery, 'sku' | 'q' | 'soloDisponibles' | 'pagina' | 'porPagina'>,
): Promise<PaginaInventario> {
  const { sku, q, soloDisponibles, pagina, porPagina } = consulta;
  const clave = JSON.stringify([almacen.companyId, almacen.warehouseId, umbralStockBajo(), sku, q, soloDisponibles, pagina, porPagina]);

  const enCache = cachePaginas.get(clave);
  if (enCache) return { ...enCache, desdeCache: true };

  const dominio = dominioInventario({ sku, q, soloDisponibles }, almacen.companyId);
  const context = { warehouse: almacen.warehouseId, allowed_company_ids: [almacen.companyId] };

  const [filas, total] = await Promise.all([
    searchRead<FilaProducto>('product.product', dominio, [...CAMPOS], {
      limit: porPagina,
      offset: (pagina - 1) * porPagina,
      order: 'default_code, id',
      context,
    }),
    executeKw<number>('product.product', 'search_count', [dominio], { context }),
  ]);

  const pagina_ = { items: filas.map(aItem), total };
  cachePaginas.set(clave, pagina_);
  return { ...pagina_, desdeCache: false };
}
