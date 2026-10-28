import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * Las cotizaciones de ASTA: los pedidos de venta de Odoo con al menos una línea
 * de la marca, creados en un periodo. El administrador ve todos; el vendedor,
 * los de los clientes de su cartera.
 *
 * Un pedido de Odoo empieza siendo una cotización (`draft`, o `sent` si se
 * envió al cliente) y se confirma (`sale`, `done`) o se cancela (`cancel`).
 * Aquí eso son tres estados: abierta, confirmada y cancelada.
 */

export const ESTADOS_COTIZACION = ['abierta', 'confirmada', 'cancelada'] as const;
export const estadoCotizacionSchema = z.enum(ESTADOS_COTIZACION);
export type EstadoCotizacion = z.infer<typeof estadoCotizacionSchema>;

/** Una cotización abierta con más de estos días sin convertirse en pedido «está sin respuesta». */
export const DIAS_SIN_RESPUESTA = 7;

/** Cuántas filas se devuelven como mucho. Las cifras de arriba cuentan todas. */
export const MAX_COTIZACIONES = 200;

export const cotizacionSchema = z.object({
  id: odooIdSchema,
  /** «S-06997». */
  folio: z.string(),
  /** El día en que se creó, en Caracas. */
  fecha: z.string(),
  /** Días desde que se creó. */
  dias: z.number().int().nonnegative(),
  /** Hasta cuándo vale el precio, si lo tiene. */
  vence: z.string().nullable(),
  estado: estadoCotizacionSchema,
  /** La ficha comercial del cliente (la que abre su ficha en el panel). */
  partnerId: odooIdSchema,
  cliente: z.string(),
  /** Quien la hizo en Odoo. */
  vendedor: z.string().nullable(),
  /** Lo de ASTA, sin IVA. */
  importeAsta: montoSchema,
  /** El pedido entero, sin IVA: con otras marcas, es más. */
  importeTotal: montoSchema,
});
export type Cotizacion = z.infer<typeof cotizacionSchema>;

const porEstado = z.object({ cotizaciones: z.number().int().nonnegative(), importeAsta: montoSchema });

export const cotizacionesSchema = z.object({
  /** Todas las del periodo, por estado. */
  totales: z.object({
    abierta: porEstado,
    confirmada: porEstado,
    cancelada: porEstado,
    /** Abiertas con más de `DIAS_SIN_RESPUESTA` días. */
    sinRespuesta: z.number().int().nonnegative(),
  }),
  estado: estadoCotizacionSchema,
  /** Las del estado pedido: las abiertas, de la más antigua a la más nueva; las demás, al revés. */
  filas: z.array(cotizacionSchema),
});
export type Cotizaciones = z.infer<typeof cotizacionesSchema>;

export const cotizacionesRespuestaSchema = z.object({
  data: cotizacionesSchema,
  meta: z.object({ generadoEn: z.string(), duracionMs: z.number() }),
});
