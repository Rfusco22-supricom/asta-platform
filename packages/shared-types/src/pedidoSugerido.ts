import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * El pedido sugerido de reposición: lo que el cliente debería volver a
 * comprarnos de ASTA, calculado con lo que vende y lo que le queda.
 *
 * ── Cómo se sugiere cada producto ────────────────────────────────────────────
 *
 *   · Con sell-out (`SELLOUT`): su venta media al mes y lo que le queda. Se le
 *     sugiere lo que le falta para tener `DIAS_COBERTURA` días de venta.
 *   · Sin sell-out (`COMPRAS`): lo que suele comprarnos al mes, menos lo que ya
 *     nos compró este mes. Sin saber lo que vende, es lo único que sabemos.
 *
 * El cliente ajusta las cantidades y lo envía. No se escribe en Odoo: llega a
 * su vendedor, que lo pasa a Odoo como cotización y lo marca en el panel.
 */

/** Para cuántos días de venta se le sugiere reponer. */
export const DIAS_COBERTURA = 45;

/** Productos como mucho en un pedido. */
export const MAX_LINEAS_SUGERIDO = 100;

/** Pedidos sin atender que puede tener un cliente a la vez. */
export const MAX_PEDIDOS_ABIERTOS = 3;

export const origenSugerenciaSchema = z.enum(['SELLOUT', 'COMPRAS']);
export type OrigenSugerencia = z.infer<typeof origenSugerenciaSchema>;

export const lineaSugeridaSchema = z.object({
  productId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  origen: origenSugerenciaSchema,
  /** Lo que le queda; `null` sin sell-out. */
  quedan: z.number().nullable(),
  /** Lo que vende al mes; `null` sin sell-out. */
  ventaMensual: z.number().nullable(),
  /** Lo que suele comprarnos al mes. */
  compraMensual: z.number(),
  /** Para cuántos días le alcanza lo que le queda; `null` sin sell-out. */
  diasQueQuedan: z.number().int().nullable(),
  sugeridas: z.number().int().positive(),
  /** Precio unitario de su tarifa, sin IVA; `null` si no se pudo leer. */
  precio: montoSchema.nullable(),
});
export type LineaSugerida = z.infer<typeof lineaSugeridaSchema>;

export const pedidoSugeridoSchema = z.object({
  /** Si algún producto sale de su sell-out. */
  conSellOut: z.boolean(),
  lineas: z.array(lineaSugeridaSchema),
});
export type PedidoSugerido = z.infer<typeof pedidoSugeridoSchema>;
export const pedidoSugeridoRespuestaSchema = z.object({ data: pedidoSugeridoSchema });

/** Lo que envía el cliente: sus cantidades, que pueden no ser las sugeridas. */
export const enviarPedidoSchema = z.object({
  lineas: z
    .array(z.object({ productId: odooIdSchema, cantidad: z.number().int().min(1).max(100_000) }))
    .min(1, 'El pedido no tiene productos.')
    .max(MAX_LINEAS_SUGERIDO),
  nota: z.string().trim().max(500).optional(),
});
export type EnviarPedido = z.infer<typeof enviarPedidoSchema>;

export const ESTADOS_PEDIDO_CLIENTE = ['ENVIADO', 'EN_ODOO', 'DESCARTADO'] as const;
export const estadoPedidoClienteSchema = z.enum(ESTADOS_PEDIDO_CLIENTE);
export type EstadoPedidoCliente = z.infer<typeof estadoPedidoClienteSchema>;

export const pedidoClienteSchema = z.object({
  id: z.string(),
  partnerId: odooIdSchema,
  cliente: z.string(),
  enviadoEn: z.string(),
  estado: estadoPedidoClienteSchema,
  nota: z.string().nullable(),
  importeEstimado: montoSchema.nullable(),
  unidades: z.number().int().nonnegative(),
  folioOdoo: z.string().nullable(),
  motivo: z.string().nullable(),
  atendidoEn: z.string().nullable(),
  lineas: z.array(
    z.object({
      productId: odooIdSchema,
      sku: z.string().nullable(),
      nombre: z.string(),
      cantidad: z.number().int().positive(),
      sugeridas: z.number().int().nullable(),
      precio: montoSchema.nullable(),
    }),
  ),
});
export type PedidoCliente = z.infer<typeof pedidoClienteSchema>;
export const pedidoClienteRespuestaSchema = z.object({ data: pedidoClienteSchema });
export const pedidosClienteRespuestaSchema = z.object({ data: z.array(pedidoClienteSchema) });

/** El vendedor (o administración) lo pasa a Odoo o lo descarta. */
export const atenderPedidoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('EN_ODOO'), folioOdoo: z.string().trim().max(64).optional() }),
  z.object({ estado: z.literal('DESCARTADO'), motivo: z.string().trim().min(1, 'Di por qué se descarta.').max(300) }),
]);
export type AtenderPedido = z.infer<typeof atenderPedidoSchema>;
