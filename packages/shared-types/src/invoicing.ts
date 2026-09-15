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

// ─────────────────────────────────────────────────────────────────────────────
// API pública: facturas del PROPIO cliente (#32, gate de seguridad #36)
// ─────────────────────────────────────────────────────────────────────────────
//
// Solo añade tipos: no toca nada de lo que consume el panel del vendedor.
//
// Ninguno de estos esquemas lleva `partner_id`. No es un olvido: en la API
// pública el cliente sale SIEMPRE de la API key, y un campo para elegirlo sería
// la puerta de la fuga que #36 existe para impedir.

/** Una factura, tal como la ve el cliente dueño de ella. */
export const publicInvoiceSchema = z.object({
  id: odooIdSchema.describe('Identificador de la factura. Es el que se usa en `/invoices/{id}`.'),
  folio: z.string().describe('Número de la factura tal como aparece impreso.'),
  fecha: odooDateSchema.nullable().describe('Fecha de emisión (`YYYY-MM-DD`).'),
  vencimiento: odooDateSchema.nullable().describe('Fecha de vencimiento (`YYYY-MM-DD`). `null` si no tiene.'),
  estadoPago: paymentStateSchema.describe(
    'Estado de pago: `not_paid` sin pagar, `partial` pagada en parte, `in_payment` pago registrado ' +
      'pendiente de conciliar, `paid` pagada, `reversed` anulada con nota de crédito, ' +
      '`invoicing_legacy` importada de un sistema anterior, `desconocido` sin estado calculado. ' +
      'Puede recibir valores nuevos: trata cualquier otro como `desconocido`.',
  ),
  /** En moneda de la compañía, igual que el resumen del panel. */
  total: montoSchema.describe('Importe total, en la moneda de la compañía que emite la factura.'),
  saldo: montoSchema.describe('Importe pendiente de pago, en la misma moneda que `total`.'),
});

export type PublicInvoice = z.infer<typeof publicInvoiceSchema>;

/**
 * Query de `GET /public/invoices`.
 *
 * No es `.strict()` a propósito: un `partner_id` que coincida con el del propio
 * cliente lo deja pasar `scopeToOwnPartner` antes de llegar aquí, y rechazarlo
 * en este punto rompería integraciones que lo mandan por inercia. Las claves
 * desconocidas simplemente se descartan.
 */
export const publicInvoiceListQuerySchema = z.object({
  desde: odooDateSchema.optional().describe('Solo facturas emitidas desde esta fecha, inclusive (`YYYY-MM-DD`).'),
  hasta: odooDateSchema.optional().describe('Solo facturas emitidas hasta esta fecha, inclusive (`YYYY-MM-DD`).'),
  /** `desconocido` no es un valor de Odoo sino la traducción de `false`: no se filtra por él. */
  estadoPago: paymentStateSchema.exclude(['desconocido']).optional().describe('Solo facturas en este estado de pago.'),
  pagina: z.coerce.number().int().positive().default(1).describe('Página, empezando en 1.'),
  porPagina: z.coerce.number().int().positive().max(100).default(50).describe('Resultados por página, hasta 100.'),
});

export type PublicInvoiceListQuery = z.infer<typeof publicInvoiceListQuerySchema>;

/** Metadatos de paginación de la API pública. */
const publicPageMetaSchema = z.object({
  pagina: z.number().int().positive().describe('Página devuelta.'),
  porPagina: z.number().int().positive().describe('Tamaño de página aplicado.'),
  total: z.number().int().nonnegative().describe('Total de resultados con estos filtros, en todas las páginas.'),
});

export const publicInvoiceListResponseSchema = z.object({
  data: z.array(publicInvoiceSchema),
  meta: publicPageMetaSchema,
});

export type PublicInvoiceListResponse = z.infer<typeof publicInvoiceListResponseSchema>;

export const publicInvoiceDetailResponseSchema = z.object({
  data: publicInvoiceSchema,
});

/** Respuesta de `GET /public/invoices/:id/pdf` (#32). */
export const publicInvoicePdfLinkResponseSchema = z.object({
  data: z.object({
    url: z.url().describe('Enlace de descarga del PDF. No necesita API key: trátalo como una credencial.'),
    expiraEn: z.iso.datetime().describe('Momento en que el enlace deja de funcionar (UTC). Hoy, 5 minutos.'),
  }),
});

export type PublicInvoicePdfLinkResponse = z.infer<typeof publicInvoicePdfLinkResponseSchema>;

export type PublicInvoiceDetailResponse = z.infer<typeof publicInvoiceDetailResponseSchema>;
