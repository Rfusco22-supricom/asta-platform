import type { CategoriaDelReporte, ClienteDelReporteProductos, ReporteProductos } from '@asta/shared-types';
import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { MARCA_ASTA, categoriasEnCompetencia } from './asta.service.js';
import { FACTURA, NOTA_DE_CREDITO, TIPO_FACTURADO_LINEA } from './criterioFacturacion.js';
import { idsDeCartera } from './partners.service.js';
import { smartbit, ventasDeClientes, type VentaSmartbit } from './smartbit.service.js';
import { LINEA_ASTA } from './ventasAsta.service.js';
import type { RangoPedido } from './rango.js';

/**
 * Qué productos ASTA compran los clientes de un vendedor (contrato en
 * `@asta/shared-types`, `reporteProductos.ts`).
 *
 * Solo ASTA desde el 5-oct-2026: el panel del vendedor es de la marca (ver
 * `ventasAsta.service`). `agregarReporte` sigue sabiendo separar ASTA de otras
 * marcas —sus tests lo prueban con las dos—, pero lo que le llega ya es ASTA,
 * así que `montoAsta` coincide con `monto`. Lo que se compra de otras marcas
 * vive en «Oportunidades ASTA».
 *
 * Con la historia de Smartbit de los clientes de la cartera (`smartbit.service`),
 * lo de antes del 1-abr-2026, convertida en grupos como los de Odoo. Solo los
 * productos que están en Odoo: sin ficha no hay categoría donde ponerlos.
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
 * cliente, 1,3 s. Son las tres condiciones de `dominioCartera`, dichas desde la
 * línea: comercial, matriz y ACTIVO.
 *
 * El `active` hay que escribirlo: al recorrer un many2one, Odoo 17 busca en el
 * otro modelo SIN `active_test`. Sin él se colaban los clientes archivados del
 * vendedor —uno con 6.940 sin IVA en junio de 2026—, que la cartera no tiene y
 * cuya ficha no abre. El alcance sigue saliendo del token: el `odooUserId` no
 * es un parámetro.
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
  const clientes = new Map<number, { nombre: string; monto: number; montoAsta: number; montoEnCompetencia: number; productos: Set<number>; porCategoria: Map<number, number> }>();
  const nombreCategoria = new Map<number, string>();
  const categoriaDe = (productId: number): [number, string] => {
    const c = ficha.get(productId)?.categ_id;
    return c ? c : [0, 'Sin categoría'];
  };

  const apartados = new Map<string, { nombre: string; monto: number; clientes: Set<number> }>();
  // «Compraron» es tener una factura: quien solo tiene una nota de crédito en el
  // periodo sale en la lista, con su negativo, pero no se cuenta como comprador.
  // La misma regla que «Compran ASTA» de la cartera.
  const conFactura = new Set<number>();

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
    if (signo === 1) conFactura.add(partnerId);
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
    const c = clientes.get(partnerId) ?? { nombre: nombreCliente.trim(), monto: 0, montoAsta: 0, montoEnCompetencia: 0, productos: new Set(), porCategoria: new Map() };
    c.monto += monto;
    if (esAsta) c.montoAsta += monto;
    if (enCompetencia.has(categoriaId)) c.montoEnCompetencia += monto;
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
      montoEnCompetencia: redondear(c.montoEnCompetencia),
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
      clientes: conFactura.size,
      productos: productos.size,
    },
    categorias: listaCategorias,
    clientes: listaClientes,
    apartados: [...apartados].map(([sku, a]) => ({ sku, nombre: a.nombre, monto: redondear(a.monto), clientes: a.clientes.size })),
  };
}

/**
 * Las ventas de Smartbit como grupos de `read_group`: una devolución (venta
 * negativa) como nota de crédito, con la cantidad en positivo, que es como la
 * da Odoo y como la resta `agregarReporte`.
 */
export function gruposSmartbit(porCliente: Map<number, VentaSmartbit[]>, rango: { desde: string; hasta: string }): GrupoLinea[] {
  const grupos: GrupoLinea[] = [];
  for (const [partnerId, ventas] of porCliente) {
    for (const v of ventas) {
      if (!v.productId || v.fecha < rango.desde || v.fecha > rango.hasta) continue;
      const devolucion = v.venta < 0;
      grupos.push({
        product_id: [v.productId, v.sku ? `[${v.sku}] ${v.articulo}` : v.articulo],
        partner_id: [partnerId, v.cliente],
        move_type: devolucion ? NOTA_DE_CREDITO : FACTURA,
        balance: -v.venta,
        quantity: devolucion ? -v.unidades : v.unidades,
      });
    }
  }
  return grupos;
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
    ['partner_id.active', '=', true],
    LINEA_ASTA,
  ];

  const [gruposOdoo, competencia, sb, cartera] = await Promise.all([
    readGroup<GrupoLinea>('account.move.line', dominio, ['balance:sum', 'quantity:sum'], ['product_id', 'partner_id', 'move_type']),
    categoriasEnCompetencia(),
    smartbit(),
    idsDeCartera(odooUserId),
  ]);
  // Detrás de los de Odoo, para que el nombre del producto y del cliente sea
  // el de Odoo cuando está en los dos.
  const grupos = [...gruposOdoo, ...gruposSmartbit(ventasDeClientes(sb, cartera), rango)];

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
