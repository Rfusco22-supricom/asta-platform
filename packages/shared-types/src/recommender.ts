import { z } from 'zod';
import { odooIdSchema } from './common.js';
import { productSchema } from './catalog.js';

/**
 * Recomendador impresora -> tóner. Lo consumen el kiosco (Track B) y el endpoint
 * público del mismo nombre.
 *
 * ATENCIÓN: este contrato asume que `asta.printer.model` y
 * `printer_compatibilities_ids` existen en Odoo. Eso todavía NO está confirmado
 * — es el issue #4, y el #7 mide si la data tiene cobertura suficiente. Si
 * alguno de los dos viene mal, este archivo cambia.
 */

export const printerModelSchema = z.object({
  id: odooIdSchema,
  nombre: z.string(),
  marca: z.string().nullable(),
  /**
   * Variantes con las que la gente busca el mismo equipo: "hl2350", "HLL2350DW".
   * Sin esto la búsqueda exacta no encuentra nada y el recomendador no sirve
   * (issue #38).
   */
  aliases: z.array(z.string()).default([]),
});

export type PrinterModel = z.infer<typeof printerModelSchema>;

export const printerSearchQuerySchema = z.object({
  /**
   * Mínimo 2 caracteres: con 1 el `ilike` devuelve medio catálogo y la tablet
   * se queda pintando una lista inútil.
   */
  q: z.string().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export type PrinterSearchQuery = z.infer<typeof printerSearchQuerySchema>;

export const printerSearchResultSchema = z.object({
  impresoras: z.array(printerModelSchema),
  /**
   * Sugerencias cuando no hubo coincidencia exacta. El kiosco las muestra como
   * "¿quisiste decir...?" en vez de un "no encontramos nada" que deja al cliente
   * sin salida frente a la pantalla.
   */
  sugerencias: z.array(printerModelSchema).default([]),
});

export type PrinterSearchResult = z.infer<typeof printerSearchResultSchema>;

export const compatibleQuerySchema = z.object({
  printerId: odooIdSchema,
  soloDisponibles: z.coerce.boolean().default(false),
});

export type CompatibleQuery = z.infer<typeof compatibleQuerySchema>;

export const compatibleResultSchema = z.object({
  impresora: printerModelSchema,
  /** Ordenados: en stock primero, luego por relevancia. */
  toners: z.array(productSchema),
  /**
   * true cuando la impresora existe pero no tiene ningún tóner asociado.
   * El kiosco debe distinguirlo de "no encontramos tu impresora": son dos
   * mensajes distintos para el cliente, y este es el síntoma visible de un
   * hueco en la data que mide el issue #7.
   */
  sinCompatibilidadesCargadas: z.boolean(),
});

export type CompatibleResult = z.infer<typeof compatibleResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Telemetría del kiosco (issue #43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evento que el kiosco envía tras cada interacción.
 *
 * Esta data no se puede reconstruir después: cada día sin instrumentar es un día
 * de información perdida sobre qué impresoras tiene el mercado.
 */
export const recommendationEventSchema = z.object({
  /** El texto crudo que tecleó el cliente, SIN normalizar: los typos enseñan qué alias faltan. */
  searchQuery: z.string().max(200),
  matchedPrinterId: odooIdSchema.nullable(),
  resultsCount: z.number().int().nonnegative(),
  clickedProductId: odooIdSchema.nullable(),
  /** Quiebre de venta medible: había producto compatible pero sin existencias. */
  wasOutOfStock: z.boolean().default(false),
});

export type RecommendationEvent = z.infer<typeof recommendationEventSchema>;
