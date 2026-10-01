import { z } from 'zod';
import { montoSchema, odooDateSchema, odooIdSchema } from './common.js';

/**
 * Pedidos de venta en la API pública (#33).
 *
 * `POST /orders` está escrito pero APAGADO (`API_PEDIDOS_ESCRITURA`): sus
 * pruebas contra un Odoo de verdad esperan a la copia de staging (#13), porque
 * crearían `sale.order` reales en producción.
 *
 * Como en las facturas, ningún esquema lleva `partner_id`: el cliente sale
 * siempre de la API key.
 *
 * Lo que NUNCA sale de aquí: el vendedor, la tarifa, el margen ni el costo. La
 * respuesta se construye campo a campo en `orders.service.ts`, con una lista
 * cerrada de campos leídos.
 */

/**
 * Estados que ve el cliente.
 *
 * `draft` solo para los pedidos que el cliente creó él mismo por la API, que
 * nacen en borrador hasta que alguien de la empresa los confirma. Los demás
 * borradores (hay 3.794) NO se ven: son trabajo interno del vendedor y pueden
 * llevar precios a medio negociar. Decidido en #33.
 */
export const estadoPedidoSchema = z.enum(['draft', 'sent', 'sale', 'cancel']);
export type EstadoPedido = z.infer<typeof estadoPedidoSchema>;

const DESCRIPCION_ESTADO =
  'Estado: `draft` pedido que creaste por la API, pendiente de que lo confirmemos; `sent` presupuesto enviado; ' +
  '`sale` pedido confirmado; `cancel` cancelado. Puede recibir valores nuevos: trata cualquier otro como `sent`.';

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

// ─────────────────────────────────────────────────────────────────────────────
// Crear un pedido
// ─────────────────────────────────────────────────────────────────────────────

/** Máximos de un pedido por la API. Un pedido más grande se hace con el vendedor. */
export const MAX_LINEAS_PEDIDO = 100;
export const MAX_CANTIDAD_LINEA = 10_000;

/**
 * Una línea: qué y cuánto. NADA de precio ni descuento.
 *
 * Estricto a propósito: un `price_unit`, `precio` o `discount` en la línea es un
 * 400, no un campo que se ignora. Si el cliente pudiera mandar el precio podría
 * fijarse el suyo, y si se ignorara en silencio creería que lo pactó. El precio
 * sale de su tarifa (#31). Decidido en #33.
 */
export const lineaPedidoNuevoSchema = z.strictObject({
  sku: z.string().min(1).describe('Referencia del producto, la misma de `/inventory` y `/pricing`.'),
  cantidad: z.number().int().positive().max(MAX_CANTIDAD_LINEA).describe(`Unidades. Entero, de 1 a ${MAX_CANTIDAD_LINEA}.`),
});

/**
 * Cuerpo de `POST /orders`.
 *
 * Sin `partner_id`: el cliente sale de la API key. Si se manda el de otro
 * cliente lo rechaza `scopeToOwnPartner` (400); si se manda el propio, se acepta
 * y se descarta antes de validar esto.
 */
export const crearPedidoBodySchema = z.strictObject({
  lineas: z
    .array(lineaPedidoNuevoSchema)
    .min(1)
    .max(MAX_LINEAS_PEDIDO)
    .describe(`Las líneas del pedido, hasta ${MAX_LINEAS_PEDIDO}. Una referencia no puede repetirse.`),
  referenciaCliente: z.string().trim().min(1).max(100).optional().describe('Tu referencia para este pedido (orden de compra). Sale en `referenciaCliente` al consultarlo.'),
});

export type CrearPedidoBody = z.infer<typeof crearPedidoBodySchema>;

/** `:orderId` de la ruta. */
export const orderIdParamSchema = z.object({ orderId: z.coerce.number().int().positive() });
