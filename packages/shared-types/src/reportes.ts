import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

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
  /**
   * null si es un cliente de Smartbit (antes de abril de 2026) cuyo RIF no está
   * en Odoo: tiene ventas, pero no ficha.
   */
  partnerId: z.number().int().positive().nullable(),
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
   * Viaja en la respuesta para que la pantalla pueda decirlo: un panel que
   * discrepa del ERP sin explicar por qué deja de usarse. Desde #26 es siempre
   * neto de devoluciones; el campo se mantiene para no romper el contrato.
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

/**
 * Las facturas con ASTA de UN vendedor en un periodo: el detalle de su fila en
 * el ranking del Inicio. Mismo criterio que `porVendedor`: los clientes que
 * tiene asignados (lo de Odoo) y las ventas que hizo él (lo de Smartbit, antes
 * del 1-abr-2026, sin número de factura). Solo la parte ASTA de cada documento.
 */
export const facturaDelVendedorSchema = z.object({
  /** El id del documento en Odoo; `null` en una compra de Smartbit. */
  id: odooIdSchema.nullable(),
  /** El número de la factura o nota de crédito; `null` en Smartbit. */
  numero: z.string().nullable(),
  /** «AAAA-MM-DD». */
  fecha: z.string(),
  tipo: z.enum(['factura', 'nota', 'smartbit']),
  partnerId: odooIdSchema.nullable(),
  cliente: z.string(),
  /** Lo ASTA del documento, sin IVA; negativo en una nota de crédito. */
  monto: montoSchema,
  /** La parte ASTA de su saldo pendiente. */
  porCobrar: montoSchema,
  /** Con saldo y la fecha de vencimiento ya pasada. */
  vencida: z.boolean(),
});

export type FacturaDelVendedor = z.infer<typeof facturaDelVendedorSchema>;

export const facturasDelVendedorSchema = z.object({
  odooUserId: odooIdSchema,
  nombre: z.string(),
  periodo: z.object({ desde: z.string(), hasta: z.string() }),
  totales: z.object({
    facturado: montoSchema,
    porCobrar: montoSchema,
    facturas: z.number().int().nonnegative(),
    notas: z.number().int().nonnegative(),
    clientes: z.number().int().nonnegative(),
  }),
  /** De la más reciente a la más antigua. */
  facturas: z.array(facturaDelVendedorSchema),
});

export type FacturasDelVendedor = z.infer<typeof facturasDelVendedorSchema>;

export const facturasDelVendedorRespuestaSchema = z.object({ data: facturasDelVendedorSchema });
