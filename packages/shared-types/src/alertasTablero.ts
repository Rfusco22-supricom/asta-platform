import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';
import { claveCategoriaSchema } from './categoriasAsta.js';

/**
 * Las alertas del tablero de ASTA, según el «Anexo de Criterios para Tablero
 * ASTA» (octubre de 2026). Tres, y solo de ASTA:
 *
 *   1. Ritmo proyectado — la proyección del mes por días hábiles queda por
 *      debajo del `ritmoMinimo` del objetivo. El objetivo es la suma de las
 *      cuotas mensuales de los clientes con nivel en el Programa ASTA, y la
 *      ejecución, lo que esos clientes llevan comprado.
 *   2. Concentración y cobertura — más del `concentracionVolumen` de lo vendido
 *      en el mes sale de menos del `concentracionBase` de los clientes o de las
 *      referencias, o compra menos del `coberturaMinima` de los clientes con
 *      nivel. Si el ritmo va bien y esto no, es prioritaria: una compra grande
 *      tapa que se está perdiendo gente.
 *   3. Tendencia temprana — por semanas: lo cotizado cae un `caidaEntrada`
 *      frente a la media de las `semanasMedia` anteriores, la conversión de
 *      cotización a pedido cae `periodosCaida` semanas seguidas, o hay
 *      productos ASTA a punto de agotarse.
 *
 * Solo las ve el administrador. Los umbrales viven solo aquí.
 */

export const UMBRALES_ALERTAS = {
  /** Proyección mínima frente al objetivo del mes. */
  ritmoMinimo: 0.9,
  /** Parte de lo vendido que, en manos de pocos, es concentración. */
  concentracionVolumen: 0.6,
  /** Qué son «pocos»: menos de esta parte de los clientes o de las referencias. */
  concentracionBase: 0.15,
  /** Parte de los clientes con nivel que tiene que estar comprando. */
  coberturaMinima: 0.85,
  /** Un cliente está activo si compró ASTA en estos últimos días. */
  diasActivo: 30,
  /** Caída de lo cotizado frente a su media que dispara la alerta. */
  caidaEntrada: 0.15,
  /** Semanas de la media móvil de lo cotizado. */
  semanasMedia: 4,
  /** Semanas seguidas cayendo que disparan la alerta. */
  periodosCaida: 3,
  /** Un producto con stock para menos de estas semanas está en riesgo. */
  semanasStockMinimo: 4,
  /** Semanas de venta con las que se calcula el ritmo de cada producto. */
  semanasVenta: 8,
  /**
   * Días hábiles del mes que tienen que haber pasado para juzgar el ritmo y la
   * concentración: el día 1 con cero ventas proyecta cero, y eso no es una alerta.
   */
  diasHabilesMinimos: 3,
} as const;

/**
 * `ok`: no se dispara. `advertencia`: se dispara. `prioritaria`: ver la alerta 2.
 * `pronto`: el mes lleva menos de `diasHabilesMinimos` días hábiles y aún no se juzga.
 */
export const estadoAlertaSchema = z.enum(['ok', 'advertencia', 'prioritaria', 'pronto']);
export type EstadoAlerta = z.infer<typeof estadoAlertaSchema>;

const proporcion = z.number().nonnegative();

const diasHabilesSchema = z.object({
  transcurridos: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  restantes: z.number().int().nonnegative(),
});

export const ritmoVendedorSchema = z.object({
  vendedor: z.string().nullable(),
  odooUserId: odooIdSchema.nullable(),
  clientes: z.number().int().nonnegative(),
  objetivo: montoSchema,
  ejecucion: montoSchema,
  proyeccion: montoSchema,
  estado: estadoAlertaSchema,
});
export type RitmoVendedor = z.infer<typeof ritmoVendedorSchema>;

export const alertaRitmoSchema = z.object({
  estado: estadoAlertaSchema,
  /** «2026-10». */
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  diasHabiles: diasHabilesSchema,
  /** Suma de las cuotas mensuales de los clientes con nivel. */
  objetivo: montoSchema,
  /** Lo que esos clientes llevan comprado de ASTA este mes. */
  ejecucion: montoSchema,
  /** Lo que tendrían que llevar hoy para acabar en el objetivo. */
  esperadoAHoy: montoSchema,
  /** A este ritmo, cuánto acaba el mes. */
  proyeccion: montoSchema,
  /** Por día hábil: lo que se lleva, y lo que hace falta en los que quedan (`null` si no queda ninguno). */
  ritmoActual: montoSchema,
  ritmoNecesario: montoSchema.nullable(),
  /** Cuánto hay que acelerar: 0,25 es un 25 % más por día. `null` si no hace falta o no se puede. */
  aceleracion: z.number().nullable(),
  clientes: z.number().int().nonnegative(),
  vendedores: z.array(ritmoVendedorSchema),
});
export type AlertaRitmo = z.infer<typeof alertaRitmoSchema>;

const concentracionSchema = z.object({
  /** Cuántos compraron (o cuántas referencias se vendieron) en el mes. */
  base: z.number().int().nonnegative(),
  /** Los primeros que se miran: menos del 15 % de la base. */
  primeros: z.number().int().nonnegative(),
  /** La parte de lo vendido que se llevan esos primeros. */
  parte: proporcion,
  dispara: z.boolean(),
});

export const clienteSinCompraSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  nivel: claveCategoriaSchema,
  vendedor: z.string().nullable(),
  cuotaMensual: montoSchema,
});
export type ClienteSinCompra = z.infer<typeof clienteSinCompraSchema>;

export const alertaConcentracionSchema = z.object({
  estado: estadoAlertaSchema,
  /** Lo vendido de ASTA este mes, a todos los clientes. */
  volumen: montoSchema,
  clientes: concentracionSchema,
  catalogo: concentracionSchema,
  cobertura: z.object({
    programados: z.number().int().nonnegative(),
    activos: z.number().int().nonnegative(),
    parte: proporcion,
    dispara: z.boolean(),
    /** Los clientes con nivel que no compraron en los últimos `diasActivo` días: a quién llamar. */
    sinCompra: z.array(clienteSinCompraSchema),
  }),
});
export type AlertaConcentracion = z.infer<typeof alertaConcentracionSchema>;

export const semanaTendenciaSchema = z.object({
  /** Lunes y domingo de la semana. */
  desde: z.string(),
  hasta: z.string(),
  /** Lo cotizado de ASTA: las líneas ASTA de los pedidos creados esa semana, sin IVA. */
  cotizado: montoSchema,
  cotizaciones: z.number().int().nonnegative(),
  /** De esas cotizaciones, las que ya son pedido. */
  confirmadas: z.number().int().nonnegative(),
  /** `confirmadas / cotizaciones`; `null` sin cotizaciones. */
  conversion: proporcion.nullable(),
  /** Lo facturado de ASTA esa semana, neto de devoluciones. */
  facturado: montoSchema,
});
export type SemanaTendencia = z.infer<typeof semanaTendenciaSchema>;

export const productoEnRiesgoSchema = z.object({
  productoId: odooIdSchema,
  codigo: z.string().nullable(),
  nombre: z.string(),
  sede: z.string(),
  /** Unidades libres hoy (sin lo reservado). */
  libre: z.number(),
  /** Unidades que se venden de media por semana. */
  ventaSemanal: z.number().nonnegative(),
  /** Cuántas semanas da el stock libre a ese ritmo. */
  semanas: z.number().nonnegative(),
  /** El stock bajó en cada una de las últimas semanas. */
  cayendo: z.boolean(),
});
export type ProductoEnRiesgo = z.infer<typeof productoEnRiesgoSchema>;

export const alertaTendenciaSchema = z.object({
  estado: estadoAlertaSchema,
  /** Las últimas semanas completas, de la más antigua a la más reciente. */
  semanas: z.array(semanaTendenciaSchema),
  entrada: z.object({
    ultima: montoSchema,
    media: montoSchema,
    /** Cuánto cayó la última frente a la media: 0,2 es un 20 % menos. Negativo si subió. */
    caida: z.number().nullable(),
    dispara: z.boolean(),
  }),
  conversion: z.object({
    /** Semanas seguidas, hasta la última, en que la conversión bajó. */
    caidasSeguidas: z.number().int().nonnegative(),
    dispara: z.boolean(),
  }),
  inventario: z.object({
    dispara: z.boolean(),
    productos: z.array(productoEnRiesgoSchema),
  }),
});
export type AlertaTendencia = z.infer<typeof alertaTendenciaSchema>;

export const alertasTableroSchema = z.object({
  /** Fecha de hoy en Caracas. */
  hoy: z.string(),
  ritmo: alertaRitmoSchema,
  concentracion: alertaConcentracionSchema,
  tendencia: alertaTendenciaSchema,
});
export type AlertasTablero = z.infer<typeof alertasTableroSchema>;

export const alertasTableroRespuestaSchema = z.object({
  data: alertasTableroSchema,
  meta: z.object({ generadoEn: z.string(), duracionMs: z.number() }),
});
