import type { EstadoPedido, PublicOrder, PublicOrderDetail, PublicOrderLine } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { executeKw, searchRead, type OdooDomain } from '../odoo/client.js';
import { logger } from '../utils/logger.js';

/**
 * Pedidos de un cliente para la API pública (#33), leídos en vivo de `sale.order`.
 *
 * ── Qué pedidos son de un cliente ────────────────────────────────────────────
 *
 * Los de `partner_id child_of <partner de la API key>`, igual que las facturas:
 * un pedido puede ir a nombre de un contacto o sucursal de la empresa. Y solo
 * por `partner_id`: `sale.order` no tiene `commercial_partner_id`, y medido
 * sobre 5.000 pedidos, ninguno se factura ni se envía a otro cliente distinto
 * del que lo pide.
 *
 * Sin borradores (`draft`): un presupuesto en borrador es trabajo interno del
 * vendedor, con precios a medio negociar. Ver `estadoPedidoSchema`. La única
 * excepción son los que el cliente creó él mismo por la API (`POST /orders`),
 * que nacen en borrador: son los `odoo_order_id` de `api_order_requests`, y se
 * pasan como `propios`.
 *
 * Esa definición vive en `dominioPedidosDe` y en ningún otro sitio. El listado y
 * el detalle la usan los dos: dos copias de un filtro de seguridad son dos
 * sitios donde una puede quedarse atrás.
 *
 * ── Qué NUNCA sale de aquí ───────────────────────────────────────────────────
 *
 * El vendedor, la tarifa, el margen, el costo. Los campos leídos son listas
 * cerradas y la respuesta se construye campo a campo: añadir `margin` a la
 * lista no lo publica sin tocar también `aPedido`.
 */

export const ESTADOS_VISIBLES: readonly EstadoPedido[] = ['sent', 'sale', 'cancel'];

/**
 * @param propios pedidos que el cliente creó por la API: se ven aunque estén en
 *   borrador. Siguen pasando por el `child_of`: estar en la lista no basta.
 */
export function dominioPedidosDe(partnerId: number, propios: readonly number[] = []): OdooDomain {
  if (!Number.isInteger(partnerId) || partnerId <= 0) throw new TypeError(`partnerId inválido: ${partnerId}`);
  const visibles: OdooDomain = [['state', 'in', [...ESTADOS_VISIBLES]]];
  return [
    ['partner_id', 'child_of', partnerId],
    ...(propios.length === 0 ? visibles : ['|', ...visibles, '&', ['state', '=', 'draft'], ['id', 'in', [...propios]]] satisfies OdooDomain),
  ];
}

/**
 * Los pedidos que este cliente creó por la API (#33).
 *
 * Si la tabla no se puede leer —desplegado sin migrar, o sin el GRANT de
 * `asta_app`—, ninguno, y se avisa: `GET /orders` sigue funcionando como antes
 * del POST, sin borradores propios. Tumbar la lectura de pedidos de todos los
 * clientes por una tabla que hoy solo usa un endpoint apagado sería peor.
 */
export async function pedidosPropios(partnerId: number): Promise<number[]> {
  try {
    const filas = await prisma.apiOrderRequest.findMany({
      where: { odooPartnerId: partnerId, estado: 'CREADO', odooOrderId: { not: null } },
      select: { odooOrderId: true },
    });
    return filas.map((f) => f.odooOrderId!);
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'pedidos: no se pudo leer api_order_requests; sin borradores propios');
    return [];
  }
}

const CAMPOS_PEDIDO = [
  'name',
  'date_order',
  'state',
  'client_order_ref',
  'currency_id',
  'amount_untaxed',
  'amount_tax',
  'amount_total',
  'invoice_status',
  'delivery_status',
] as const;

interface FilaPedido {
  id: number;
  name: string;
  date_order: string;
  state: EstadoPedido;
  client_order_ref: string | false;
  currency_id: [number, string];
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  invoice_status: PublicOrder['estadoFacturacion'];
  delivery_status: Exclude<PublicOrder['estadoEntrega'], null> | false;
}

const CAMPOS_LINEA = [
  'product_id',
  'name',
  'product_uom_qty',
  'price_unit',
  'discount',
  'price_subtotal',
  'price_total',
  'qty_delivered',
  'qty_invoiced',
] as const;

interface FilaLinea {
  id: number;
  product_id: [number, string] | false;
  name: string;
  product_uom_qty: number;
  price_unit: number;
  discount: number;
  price_subtotal: number;
  price_total: number;
  qty_delivered: number;
  qty_invoiced: number;
}

function redondear(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** `YYYY-MM-DD HH:MM:SS` de Odoo, que está en UTC, a ISO 8601. */
function fechaIso(f: string): string {
  return `${f.replace(' ', 'T')}Z`;
}

function aPedido(f: FilaPedido): PublicOrder {
  return {
    id: f.id,
    folio: f.name,
    fecha: fechaIso(f.date_order),
    estado: f.state,
    referenciaCliente: f.client_order_ref ? f.client_order_ref.trim() || null : null,
    moneda: f.currency_id[1],
    subtotal: redondear(f.amount_untaxed),
    impuestos: redondear(f.amount_tax),
    total: redondear(f.amount_total),
    estadoFacturacion: f.invoice_status,
    estadoEntrega: f.delivery_status || null,
  };
}

export interface ConsultaPedidos {
  desde?: string;
  hasta?: string;
  estado?: EstadoPedido;
  limit: number;
  offset: number;
}

/** Pedidos de un cliente, paginados. Cuesta 2 RPC. */
export async function listarPedidos(partnerId: number, q: ConsultaPedidos): Promise<{ pedidos: PublicOrder[]; total: number }> {
  const dominio = dominioPedidosDe(partnerId, await pedidosPropios(partnerId));
  // `date_order` es fecha y hora en UTC: el día entero, de 00:00:00 a 23:59:59.
  if (q.desde) dominio.push(['date_order', '>=', `${q.desde} 00:00:00`]);
  if (q.hasta) dominio.push(['date_order', '<=', `${q.hasta} 23:59:59`]);
  if (q.estado) dominio.push(['state', '=', q.estado]);

  const [filas, total] = await Promise.all([
    searchRead<FilaPedido>('sale.order', dominio, [...CAMPOS_PEDIDO], {
      limit: q.limit,
      offset: q.offset,
      // `id desc` desempata, como en `/invoices`.
      order: 'date_order desc, id desc',
    }),
    executeKw<number>('sale.order', 'search_count', [dominio]),
  ]);
  return { pedidos: filas.map(aPedido), total };
}

/**
 * Un pedido con sus líneas, SOLO si es del cliente y está en un estado visible.
 *
 * El id y el cliente van en el MISMO dominio, como en `getPartnerInvoice`: uno
 * de otro cliente, uno en borrador y uno que no existe son la misma consulta
 * vacía, `null`.
 */
export async function verPedido(partnerId: number, orderId: number): Promise<PublicOrderDetail | null> {
  const [f] = await searchRead<FilaPedido>('sale.order', [...dominioPedidosDe(partnerId, await pedidosPropios(partnerId)), ['id', '=', orderId]], [...CAMPOS_PEDIDO], {
    limit: 1,
  });
  if (!f) return null;

  // Las líneas por `order_id` del pedido ya comprobado. Sin las de sección ni nota.
  const lineas = await searchRead<FilaLinea>(
    'sale.order.line',
    [['order_id', '=', f.id], ['display_type', '=', false]],
    [...CAMPOS_LINEA],
    { order: 'sequence, id' },
  );

  const idsProducto = [...new Set(lineas.flatMap((l) => (l.product_id ? [l.product_id[0]] : [])))];
  // También los archivados: un pedido viejo puede llevar un producto retirado,
  // y su referencia sigue siendo la que el cliente compró.
  const productos =
    idsProducto.length === 0
      ? []
      : await searchRead<{ id: number; default_code: string | false }>(
          'product.product',
          [['id', 'in', idsProducto], ['active', 'in', [true, false]]],
          ['default_code'],
        );
  const skuDe = new Map(productos.map((p) => [p.id, p.default_code || null]));

  return { ...aPedido(f), lineas: lineas.map((l) => aLinea(l, skuDe)) };
}

function aLinea(l: FilaLinea, skuDe: Map<number, string | null>): PublicOrderLine {
  const productId = l.product_id ? l.product_id[0] : null;
  return {
    productId,
    sku: productId === null ? null : skuDe.get(productId) ?? null,
    descripcion: l.name,
    cantidad: l.product_uom_qty,
    precioUnitario: l.price_unit,
    descuento: l.discount,
    subtotal: redondear(l.price_subtotal),
    total: redondear(l.price_total),
    cantidadEntregada: l.qty_delivered,
    cantidadFacturada: l.qty_invoiced,
  };
}

/**
 * ¿Es este pedido de OTRO cliente?
 *
 * Solo para AUDITAR, como `invoiceExists`. Y más estricto: un borrador del
 * propio cliente también responde 404, pero no es un intento de acceso cruzado
 * y no debe llenar la auditoría de ruido (#46).
 */
export async function esPedidoAjeno(partnerId: number, orderId: number): Promise<boolean> {
  const n = await executeKw<number>('sale.order', 'search_count', [[['id', '=', orderId], '!', ['partner_id', 'child_of', partnerId]]]);
  return n > 0;
}
