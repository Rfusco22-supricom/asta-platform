import type { CategoriaDelReporte, ClienteDelReporteProductos, ReporteProductos } from '@asta/shared-types';
import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { MARCA_ASTA, categoriasEnCompetencia } from './asta.service.js';
import { NOTA_DE_CREDITO, TIPO_FACTURADO_LINEA } from './criterioFacturacion.js';
import type { RangoPedido } from './rango.js';

/**
 * Qué compran los clientes de un vendedor, producto a producto (contrato en
 * `@asta/shared-types`, `reporteProductos.ts`).
 *
 * ── Un `read_group` y una lectura ────────────────────────────────────────────
 *
 * Las líneas de factura de la cartera, agrupadas por producto × cliente × tipo
 * de documento, y después los productos que salieron, para saber su categoría y
 * su marca. Odoo no agrupa por `product_id.categ_id` (es un campo de otro
 * modelo), así que la categoría se pone aquí.
 *
 * ── Por qué el filtro es `partner_id.user_id` y no la lista de la cartera ────
 *
 * Medido el 2-oct-2026 en producción con la cartera más grande (796 clientes):
 * con `partner_id in [...]` el agrupado tardaba 14,7 s; con el comercial del
 * cliente, 1,3 s. Es el mismo conjunto: comprobado en tres carteras, mismo
 * total al céntimo y ningún cliente fuera de `dominioCartera`. Al buscar por un
 * campo de otro modelo Odoo aplica `active_test`, así que los clientes
 * archivados quedan fuera igual que en la cartera; `parent_id = false` es la
 * otra mitad de esa definición. El alcance sigue saliendo del token: el
 * `odooUserId` no es un parámetro.
 *
 * ── Caché ────────────────────────────────────────────────────────────────────
 *
 * Diez minutos por vendedor y periodo, como la actividad de la cartera.
 */

const cache = new CacheTtl<Omit<ReporteProductos, 'meta'> & { generadoEn: string }>(10 * 60_000, 500);

/** Para los tests. */
export function vaciarCacheReporteProductos(): void {
  cache.vaciar();
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "[SKU] Nombre" de los many2one de producto, partido en sus dos piezas. */
function partirNombre(display: string): { sku: string | null; nombre: string } {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(display.trim());
  return m ? { sku: m[1]!, nombre: m[2] || display.trim() } : { sku: null, nombre: display.trim() };
}

/**
 * Productos que se facturan pero no son una venta.
 *
 * «Saldo Inicial» es un servicio con el que se cargaron los saldos de apertura:
 * medido el 2-oct-2026, 7,0 M de los 33,4 M vendidos sin IVA en doce meses, en
 * 2.676 facturas. Contado como producto, sería «lo que más compran» casi todos
 * los clientes. Se aparta y se dice cuánto (`apartados`).
 *
 * Por la referencia y no por el tipo: los demás servicios —flete, rebate,
 * instalación, licencias— sí son ventas.
 */
export const NO_SON_VENTA = new Set(['SAL_INI']);

export interface GrupoLinea {
  product_id: [number, string] | false;
  partner_id: [number, string] | false;
  move_type: string | false;
  /** Negativo en las facturas (es un ingreso), positivo en las notas de crédito. */
  balance: number;
  quantity: number;
}

export interface FichaProducto {
  id: number;
  categ_id: [number, string] | false;
  spiff_brand_id: [number, string] | false;
}

/** La agregación, sin Odoo de por medio: se prueba con datos hechos a mano. */
export function agregarReporte(
  grupos: GrupoLinea[],
  fichas: FichaProducto[],
  /** Las categorías donde ASTA tiene producto (`categoriasEnCompetencia`). */
  enCompetencia: Set<number> = new Set(),
): Pick<ReporteProductos, 'totales' | 'categorias' | 'clientes' | 'apartados'> {
  const ficha = new Map(fichas.map((f) => [f.id, f]));

  type Prod = { productId: number; sku: string | null; nombre: string; marca: string | null; esAsta: boolean; cantidad: number; monto: number; porCliente: Map<number, { nombre: string; cantidad: number; monto: number }> };
  const productos = new Map<number, Prod>();
  const clientes = new Map<number, { nombre: string; monto: number; montoAsta: number; productos: Set<number>; porCategoria: Map<number, number> }>();
  const nombreCategoria = new Map<number, string>();
  const categoriaDe = (productId: number): [number, string] => {
    const c = ficha.get(productId)?.categ_id;
    return c ? c : [0, 'Sin categoría'];
  };

  const apartados = new Map<string, { nombre: string; monto: number; clientes: Set<number> }>();

  for (const g of grupos) {
    // Líneas sin producto (un concepto escrito a mano): no son de ningún producto.
    if (!g.product_id || !g.partner_id) continue;
    const [productId, display] = g.product_id;
    const [partnerId, nombreCliente] = g.partner_id;

    const { sku, nombre } = partirNombre(display);
    if (sku && NO_SON_VENTA.has(sku)) {
      const a = apartados.get(sku) ?? { nombre, monto: 0, clientes: new Set<number>() };
      a.monto += -g.balance;
      a.clientes.add(partnerId);
      apartados.set(sku, a);
      continue;
    }

    const signo = g.move_type === NOTA_DE_CREDITO ? -1 : 1;
    const monto = -g.balance;
    const cantidad = signo * g.quantity;
    const marca = ficha.get(productId)?.spiff_brand_id || false;
    const esAsta = marca ? marca[0] === MARCA_ASTA : false;

    let p = productos.get(productId);
    if (!p) {
      p = { productId, ...partirNombre(display), marca: marca ? marca[1] : null, esAsta, cantidad: 0, monto: 0, porCliente: new Map() };
      productos.set(productId, p);
    }
    p.cantidad += cantidad;
    p.monto += monto;
    const pc = p.porCliente.get(partnerId) ?? { nombre: nombreCliente.trim(), cantidad: 0, monto: 0 };
    pc.cantidad += cantidad;
    pc.monto += monto;
    p.porCliente.set(partnerId, pc);

    const [categoriaId, categoria] = categoriaDe(productId);
    nombreCategoria.set(categoriaId, categoria);
    const c = clientes.get(partnerId) ?? { nombre: nombreCliente.trim(), monto: 0, montoAsta: 0, productos: new Set(), porCategoria: new Map() };
    c.monto += monto;
    if (esAsta) c.montoAsta += monto;
    c.productos.add(productId);
    c.porCategoria.set(categoriaId, (c.porCategoria.get(categoriaId) ?? 0) + monto);
    clientes.set(partnerId, c);
  }

  const porMonto = <T extends { monto: number }>(a: T, b: T) => b.monto - a.monto;

  const categorias = new Map<number, CategoriaDelReporte & { _clientes: Set<number> }>();
  for (const p of productos.values()) {
    const [categoriaId, nombre] = categoriaDe(p.productId);
    const c = categorias.get(categoriaId) ?? { categoriaId, nombre, monto: 0, montoAsta: 0, enCompetencia: enCompetencia.has(categoriaId), clientes: 0, productos: [], _clientes: new Set<number>() };
    c.monto += p.monto;
    if (p.esAsta) c.montoAsta += p.monto;
    for (const id of p.porCliente.keys()) c._clientes.add(id);
    c.productos.push({
      productId: p.productId,
      sku: p.sku,
      nombre: p.nombre,
      marca: p.marca,
      esAsta: p.esAsta,
      cantidad: redondear(p.cantidad),
      monto: redondear(p.monto),
      clientes: [...p.porCliente]
        .map(([partnerId, x]) => ({ partnerId, nombre: x.nombre, cantidad: redondear(x.cantidad), monto: redondear(x.monto) }))
        .sort(porMonto),
    });
    categorias.set(categoriaId, c);
  }

  const listaCategorias = [...categorias.values()]
    .map(({ _clientes, ...c }) => ({
      ...c,
      monto: redondear(c.monto),
      montoAsta: redondear(c.montoAsta),
      clientes: _clientes.size,
      productos: c.productos.sort(porMonto),
    }))
    .sort(porMonto);

  const listaClientes: ClienteDelReporteProductos[] = [...clientes]
    .map(([partnerId, c]) => ({
      partnerId,
      nombre: c.nombre,
      monto: redondear(c.monto),
      montoAsta: redondear(c.montoAsta),
      productosDistintos: c.productos.size,
      categorias: [...c.porCategoria]
        .map(([categoriaId, monto]) => ({ categoriaId, nombre: nombreCategoria.get(categoriaId) ?? 'Sin categoría', monto: redondear(monto) }))
        .sort(porMonto),
    }))
    .sort(porMonto);

  const monto = [...productos.values()].reduce((s, p) => s + p.monto, 0);
  const montoAsta = [...productos.values()].filter((p) => p.esAsta).reduce((s, p) => s + p.monto, 0);
  const montoEnCompetencia = [...productos.values()].filter((p) => enCompetencia.has(categoriaDe(p.productId)[0])).reduce((s, p) => s + p.monto, 0);

  return {
    totales: {
      monto: redondear(monto),
      montoAsta: redondear(montoAsta),
      montoEnCompetencia: redondear(montoEnCompetencia),
      clientes: clientes.size,
      productos: productos.size,
    },
    categorias: listaCategorias,
    clientes: listaClientes,
    apartados: [...apartados].map(([sku, a]) => ({ sku, nombre: a.nombre, monto: redondear(a.monto), clientes: a.clientes.size })),
  };
}

export async function reporteProductos(odooUserId: number, rango: RangoPedido, ahora = new Date()): Promise<ReporteProductos> {
  const clave = `${odooUserId}:${rango.desde}:${rango.hasta}`;
  const enCache = cache.get(clave);
  if (enCache) {
    const { generadoEn, ...resto } = enCache;
    return { ...resto, meta: { generadoEn, desdeCache: true } };
  }

  const dominio: OdooDomain = [
    ['display_type', '=', 'product'],
    ['parent_state', '=', 'posted'],
    TIPO_FACTURADO_LINEA,
    ['invoice_date', '>=', rango.desde],
    ['invoice_date', '<=', rango.hasta],
    // La cartera (`dominioCartera`), dicha desde la línea: ver la cabecera.
    ['partner_id.user_id', '=', odooUserId],
    ['partner_id.parent_id', '=', false],
  ];

  const [grupos, competencia] = await Promise.all([
    readGroup<GrupoLinea>('account.move.line', dominio, ['balance:sum', 'quantity:sum'], ['product_id', 'partner_id', 'move_type']),
    categoriasEnCompetencia(),
  ]);

  const ids = [...new Set(grupos.map((g) => (g.product_id ? g.product_id[0] : 0)).filter(Boolean))];
  // Los archivados también: se vendieron en el periodo aunque hoy no se vendan.
  const fichas = ids.length
    ? await searchRead<FichaProducto>('product.product', [['id', 'in', ids]], ['categ_id', 'spiff_brand_id'], { context: { active_test: false } })
    : [];

  const resultado = { periodo: { desde: rango.desde, hasta: rango.hasta }, ...agregarReporte(grupos, fichas, new Set(competencia)), generadoEn: ahora.toISOString() };
  cache.set(clave, resultado);
  const { generadoEn, ...resto } = resultado;
  return { ...resto, meta: { generadoEn, desdeCache: false } };
}
