import { z } from 'zod';
import { montoSchema } from './common.js';
import { publicInvoiceSchema } from './invoicing.js';

/**
 * «Mis facturas» del cliente en el panel: lo que debe, lo que vence pronto y
 * todas sus facturas de venta, con el PDF. Las mismas facturas que la API
 * pública (`/public/invoices`): el filtro de qué es suyo es uno solo.
 *
 * «Debe» es el saldo de las facturas sin pagar o pagadas en parte. Un pago ya
 * registrado pero sin conciliar (`in_payment`) no cuenta como deuda: el cliente
 * ya pagó. Las notas de crédito no se restan aquí.
 */

/** Cuántos días por delante cuentan como «vence pronto». */
export const DIAS_VENCE_PRONTO = 7;

export const FACTURAS_POR_PAGINA = 25;

export const resumenCobroSchema = z.object({
  /** Lo que debe en total. */
  porPagar: montoSchema,
  facturasPorPagar: z.number().int().nonnegative(),
  /** Lo que ya pasó de su vencimiento. */
  vencido: montoSchema,
  facturasVencidas: z.number().int().nonnegative(),
  /** Lo que vence entre hoy y `DIAS_VENCE_PRONTO` días. */
  vencePronto: montoSchema,
  facturasVencenPronto: z.number().int().nonnegative(),
  /** El próximo vencimiento de lo que debe, de hoy en adelante. */
  proximoVencimiento: z.string().nullable(),
});
export type ResumenCobro = z.infer<typeof resumenCobroSchema>;

export const vistaFacturasSchema = z.enum(['pendientes', 'todas']);
export type VistaFacturas = z.infer<typeof vistaFacturasSchema>;

export const facturasClienteSchema = z.object({
  resumen: resumenCobroSchema,
  vista: vistaFacturasSchema,
  facturas: z.array(publicInvoiceSchema),
  pagina: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type FacturasCliente = z.infer<typeof facturasClienteSchema>;
export const facturasClienteRespuestaSchema = z.object({ data: facturasClienteSchema });
