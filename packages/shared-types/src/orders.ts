import { z } from 'zod';
import { montoSchema, odooDateSchema, odooIdSchema } from './common.js';

/**
 * Pedidos de venta en la API pública (#33). Solo LECTURA por ahora: crear
 * pedidos (`POST /orders`) espera a la copia de staging de Odoo (#13), porque
 * sus tests crearían `sale.order` reales en producción.
 *
 * Como en las facturas, ningún esquema lleva `partner_id`: el cliente sale
 * siempre de la API key.
 *
 * Lo que NUNCA sale de aquí: el vendedor, la tarifa, el margen ni el costo. La
 * respuesta se construye campo a campo en `orders.service.ts`, con una lista
 * cerrada de campos leídos.
 */

/**
 * Estados que ve el cliente. `draft` NO está: un presupuesto en borrador es
 * trabajo interno del vendedor y puede llevar precios a medio negociar (hay
 * 3.794). Decidido en #33.
 */
export const estadoPedidoSchema = z.enum(['sent', 'sale', 'cancel']);
export type EstadoPedido = z.infer<typeof estadoPedidoSchema>;

const DESCRIPCION_ESTADO =
  'Estado: `sent` presupuesto enviado, `sale` pedido confirmado, `cancel` cancelado. ' +
  'Puede recibir valores nuevos: trata cualquier otro como `sent`.';

export const publicOrderSchema = z.object({
  id: odooIdSchema.describe('Identificador del pedido. Es el que se usa en `/orders/{orderId}`.'),
  folio: z.string().describe('Número del pedido o presupuesto, tal como aparece impreso.'),
  fecha: z.iso.datetime().describe('Fecha del pedido, en UTC.'),
  estado: estadoPedidoSchema.describe(DESCRIPCION_ESTADO),
  referenciaCliente: z.string().nullable().describe('Tu referencia para este pedido (orden de compra). `null` si no la tiene.'),
  moneda: z.string().describe('Moneda del pedido (ISO 4217).'),
  subtotal: montoSchema.describe('Importe sin impuestos.'),
  impuestos: montoSchema.describe('Impuestos.'),
  total: montoSchema.describe('Importe total, impuestos incluidos.'),
  estadoFacturacion: z
    .enum(['no', 'to invoice', 'invoiced', 'upselling'])
    .describe('`no` nada que facturar, `to invoice` pendiente de facturar, `invoiced` facturado, `upselling` facturado y con más pedido. Puede recibir valores nuevos.'),
  estadoEntrega: z
    .enum(['pending', 'started', 'partial', 'full'])
    .nullable()
    .describe('`pending` sin entregar, `started` en preparación, `partial` entregado en parte, `full` entregado. `null` si no lleva entrega. Puede recibir valores nuevos.'),
});

export type PublicOrder = z.infer<typeof publicOrderSchema>;

export const publicOrderLineSchema = z.object({
  productId: odooIdSchema.nullable().describe('Producto, el mismo `id` de `/inventory`. `null` en líneas sin producto.'),
  sku: z.string().nullable().describe('Referencia del producto. `null` si no tiene.'),
  descripcion: z.string().describe('Descripción de la línea, tal como aparece en el pedido.'),
  cantidad: z.number().describe('Cantidad pedida.'),
  precioUnitario: montoSchema.describe('Precio unitario, sin impuestos ni descuento.'),
  descuento: z.number().describe('Descuento de la línea, en porcentaje.'),
  subtotal: montoSchema.describe('Importe de la línea sin impuestos, con el descuento aplicado.'),
  total: montoSchema.describe('Importe de la línea con impuestos.'),
  cantidadEntregada: z.number().describe('Cantidad ya entregada.'),
  cantidadFacturada: z.number().describe('Cantidad ya facturada.'),
});

export type PublicOrderLine = z.infer<typeof publicOrderLineSchema>;

export const publicOrderDetailSchema = publicOrderSchema.extend({
  lineas: z.array(publicOrderLineSchema).describe('Las líneas del pedido. Sin las de sección ni las de nota.'),
});

export type PublicOrderDetail = z.infer<typeof publicOrderDetailSchema>;

/** Query de `GET /public/orders`. Como `/invoices`: no es `.strict()` a propósito. */
export const publicOrderListQuerySchema = z.object({
  desde: odooDateSchema.optional().describe('Solo pedidos desde esta fecha, inclusive (`YYYY-MM-DD`, en UTC).'),
  hasta: odooDateSchema.optional().describe('Solo pedidos hasta esta fecha, inclusive (`YYYY-MM-DD`, en UTC).'),
  estado: estadoPedidoSchema.optional().describe('Solo pedidos en este estado.'),
  pagina: z.coerce.number().int().positive().default(1).describe('Página, empezando en 1.'),
  porPagina: z.coerce.number().int().positive().max(100).default(50).describe('Resultados por página, hasta 100.'),
});

export type PublicOrderListQuery = z.infer<typeof publicOrderListQuerySchema>;

export const publicOrderListResponseSchema = z.object({
  data: z.array(publicOrderSchema),
  meta: z.object({
    pagina: z.number().int().positive().describe('Página devuelta.'),
    porPagina: z.number().int().positive().describe('Tamaño de página aplicado.'),
    total: z.number().int().nonnegative().describe('Total de pedidos con estos filtros, en todas las páginas.'),
  }),
});

export type PublicOrderListResponse = z.infer<typeof publicOrderListResponseSchema>;

export const publicOrderDetailResponseSchema = z.object({
  data: publicOrderDetailSchema,
});

export type PublicOrderDetailResponse = z.infer<typeof publicOrderDetailResponseSchema>;

/** `:orderId` de la ruta. */
export const orderIdParamSchema = z.object({ orderId: z.coerce.number().int().positive() });
