import { z } from 'zod';
import { montoSchema, odooDateSchema, odooIdSchema } from './common.js';

/**
 * Contrato de facturación. Lo consume el panel del vendedor (Track A) y el
 * endpoint público de facturas del cliente (Track B), así que cualquier cambio
 * aquí toca a los dos tracks.
 *
 * Debe mantenerse alineado con `apps/middleware/src/services/invoicing.service.ts`.
 */

/** Estados de conciliación de pago de Odoo 16+. */
export const paymentStateSchema = z.enum([
  'not_paid',
  'in_payment',
  'paid',
  'partial',
  'reversed',
  'invoicing_legacy',
  /** Odoo devolvió `false`: factura sin estado de pago calculado. */
  'desconocido',
]);

export type PaymentState = z.infer<typeof paymentStateSchema>;

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  not_paid: 'Sin pagar',
  in_payment: 'En proceso de pago',
  paid: 'Pagada',
  partial: 'Pago parcial',
  reversed: 'Revertida',
  invoicing_legacy: 'Facturación heredada',
  desconocido: 'Sin determinar',
};

// ─────────────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────────────

export const invoicingQuerySchema = z.object({
  desde: odooDateSchema.optional(),
  hasta: odooDateSchema.optional(),
  /**
   * Incluir notas de crédito (`out_refund`), que restan del total.
   *
   * Por defecto `false`: es la definición literal de "total facturado" de la
   * especificación. El criterio definitivo lo decide el issue #26 — y una vez
   * decidido, debe ser el MISMO en todo el panel, o el vendedor verá un número
   * distinto al de Odoo y dejará de confiar en la herramienta.
   */
  incluirNotasDeCredito: z.coerce.boolean().default(false),
  incluirSerieMensual: z.coerce.boolean().default(false),
});

export type InvoicingQuery = z.infer<typeof invoicingQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Respuesta
// ─────────────────────────────────────────────────────────────────────────────

export const paymentStateBreakdownSchema = z.object({
  estado: paymentStateSchema,
  monto: montoSchema,
  saldo: montoSchema,
  facturas: z.number().int().nonnegative(),
});

export const lastInvoiceSchema = z.object({
  id: odooIdSchema,
  folio: z.string(),
  fecha: odooDateSchema.nullable(),
  monto: montoSchema,
  estadoPago: paymentStateSchema.nullable(),
});

export const monthlyPointSchema = z.object({
  /** Etiqueta de periodo tal como la devuelve Odoo: "enero 2026". */
  periodo: z.string(),
  monto: montoSchema,
  facturas: z.number().int().nonnegative(),
});

export const invoicingSummarySchema = z.object({
  partnerId: odooIdSchema,
  /**
   * Los importes vienen de `amount_total_signed`, que Odoo expresa en la moneda
   * de la compañía. Por eso el valor literal "company" y no un código ISO: no
   * hay conversión por cliente.
   */
  currency: z.literal('company'),
  totalFacturado: montoSchema,
  porCobrar: montoSchema,
  cobrado: montoSchema,
  numeroFacturas: z.number().int().nonnegative(),
  ticketPromedio: montoSchema,
  desglosePorEstadoDePago: z.array(paymentStateBreakdownSchema),
  ultimaFactura: lastInvoiceSchema.nullable(),
  serieMensual: z.array(monthlyPointSchema).optional(),
});

export type InvoicingSummary = z.infer<typeof invoicingSummarySchema>;
export type PaymentStateBreakdown = z.infer<typeof paymentStateBreakdownSchema>;
export type LastInvoice = z.infer<typeof lastInvoiceSchema>;
export type MonthlyPoint = z.infer<typeof monthlyPointSchema>;

/** Respuesta de `GET /salesperson/clients/:partnerId/invoicing`. */
export const clientInvoicingResponseSchema = z.object({
  cliente: z.object({
    id: odooIdSchema,
    nombre: z.string().optional(),
    tier: z.string().nullable().optional(),
  }),
  facturacion: invoicingSummarySchema,
});

export type ClientInvoicingResponse = z.infer<typeof clientInvoicingResponseSchema>;
