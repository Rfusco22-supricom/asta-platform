import { z } from 'zod';
import { montoSchema } from './common.js';

/**
 * Reportes de facturación por periodo.
 *
 * El mismo contrato sirve a las dos pantallas —la de administración y la del
 * vendedor— pero NO al mismo endpoint: son dos rutas con dos permisos, igual
 * que en ASTA (#25). `porVendedor` viene en `null` en la del vendedor, y eso no
 * es un detalle de presentación: es que esa ruta nunca calcula ese corte.
 */

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'la fecha debe ser YYYY-MM-DD');

export const rangoSchema = z.object({
  desde: fechaSchema,
  hasta: fechaSchema,
});

export type Rango = z.infer<typeof rangoSchema>;

export const puntoSerieSchema = z.object({
  /** YYYY-MM. Los meses sin factura vienen en cero, no se omiten. */
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  monto: montoSchema,
  facturas: z.number().int().nonnegative(),
});

export const clienteDelReporteSchema = z.object({
  partnerId: z.number().int().positive(),
  nombre: z.string(),
  facturado: montoSchema,
  facturas: z.number().int().nonnegative(),
});

export const vendedorDelReporteSchema = z.object({
  /** null cuando la factura no tiene comercial asignado en Odoo. */
  odooUserId: z.number().int().positive().nullable(),
  nombre: z.string(),
  facturado: montoSchema,
  porCobrar: montoSchema,
  facturas: z.number().int().nonnegative(),
});

export const reporteRespuestaSchema = z.object({
  periodo: rangoSchema,
  /**
   * Con qué criterio se sumó.
   *
   * Viaja en la respuesta para que la pantalla pueda decirlo. La decisión de
   * fondo —si «facturado» lleva notas de crédito— sigue abierta (#26), y
   * mientras no se cierre lo importante es que el número nunca aparezca sin
   * decir cómo está calculado: un panel que discrepa del ERP sin explicar por
   * qué deja de usarse.
   */
  criterio: z.object({
    incluyeNotasDeCredito: z.boolean(),
    soloContabilizadas: z.literal(true),
  }),

  totales: z.object({
    facturado: montoSchema,
    porCobrar: montoSchema,
    facturas: z.number().int().nonnegative(),
    ticketPromedio: montoSchema,
    clientes: z.number().int().nonnegative(),
  }),

  serieMensual: z.array(puntoSerieSchema),
  topClientes: z.array(clienteDelReporteSchema),
  /** `null` en la vista del vendedor: esa ruta no calcula este corte. */
  porVendedor: z.array(vendedorDelReporteSchema).nullable(),

  asta: z.object({
    asta: montoSchema,
    competencia: montoSchema,
    /** Porcentaje del gasto en consumibles que se llevó ASTA. */
    cuota: z.number().min(0).max(100),
  }),

  generadoEn: z.iso.datetime(),
  duracionMs: z.number().int().nonnegative(),
});

export type ReporteRespuesta = z.infer<typeof reporteRespuestaSchema>;
