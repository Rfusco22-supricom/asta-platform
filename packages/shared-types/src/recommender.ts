import { z } from 'zod';
import { odooIdSchema } from './common.js';
import { stockStatusSchema } from './catalog.js';

/**
 * Recomendador impresora -> tóner (#39). Superficie de la API pública; el
 * kiosco (Track B) consumirá el mismo contrato.
 *
 * La compatibilidad NO vive en Odoo: está en MySQL (#56, tablas de #101). Por
 * eso el `id` de una impresora es de nuestra base, no un id de Odoo, y los
 * productos sí lo son.
 *
 * Solo se sirve lo VALIDADO por una persona, en los dos tramos: impresora →
 * cartucho y cartucho → producto. Una propuesta del importador que llega al
 * cliente es venderle, delante de él, un tóner que no le sirve.
 *
 * Sin precio, igual que `/inventory`: la tarifa del cliente es #31, bloqueado
 * por #3 y #5.
 */

/** Una impresora del catálogo de compatibilidad. */
export const publicPrinterSchema = z.object({
  id: z.number().int().positive().describe('Identificador de la impresora. Úsalo en `/recommender/printers/{printerId}/compatible`.'),
  marca: z.string().describe('Marca de la impresora.'),
  nombre: z.string().describe('Modelo, como lo escribe el fabricante.'),
});

export type PublicPrinter = z.infer<typeof publicPrinterSchema>;

/** Query de `GET /api/v1/public/recommender/printers`. */
export const printerSearchQuerySchema = z.object({
  /**
   * Mínimo 2 caracteres: con 1 cualquier cosa coincide con todo y la tablet se
   * queda pintando una lista inútil.
   */
  q: z.string().min(2).max(80).describe('Lo que se sabe del modelo, como lo escribiría una persona: `hl2350`, `M404dn`, `epson l3150`. Mínimo 2 caracteres.'),
  limit: z.coerce.number().int().min(1).max(25).default(10).describe('Máximo de impresoras devueltas, hasta 25.'),
});

export type PrinterSearchQuery = z.infer<typeof printerSearchQuerySchema>;

export const publicPrinterSearchResponseSchema = z.object({
  data: z.array(publicPrinterSchema).describe('Impresoras que coinciden, de la más a la menos probable.'),
  /**
   * Solo cuando `data` viene vacío. Aparte a propósito: la interfaz debe
   * PREGUNTAR ("¿quisiste decir…?"), no afirmar que es la impresora del cliente.
   */
  sugerencias: z.array(publicPrinterSchema).describe('Solo si no hubo coincidencias: modelos parecidos, para preguntar «¿quisiste decir…?». No los trates como coincidencias.'),
});

export type PublicPrinterSearchResponse = z.infer<typeof publicPrinterSearchResponseSchema>;

/** Query de `GET /api/v1/public/recommender/printers/{printerId}/compatible`. */
export const compatibleQuerySchema = z.object({
  soloDisponibles: z.stringbool().default(false).describe('`true` para devolver solo productos con existencia (`disponible` o `bajo`).'),
});

export type CompatibleQuery = z.infer<typeof compatibleQuerySchema>;

/**
 * El tope es el de la columna (`INT UNSIGNED`): por encima, Prisma no filtra,
 * falla, y la petición acabaría en 500 en vez de en 400.
 */
export const printerIdParamSchema = z.object({ printerId: z.coerce.number().int().positive().max(4_294_967_295) });

export const cartridgeKindSchema = z.enum(['toner', 'tinta', 'tambor', 'otro']);

/** El cartucho del fabricante al que corresponde un producto. */
export const publicCartridgeSchema = z.object({
  marca: z.string().describe('Fabricante del cartucho original.'),
  codigo: z.string().describe('Código del cartucho del fabricante: `CE278A`, `TN-227C`.'),
  tipo: cartridgeKindSchema.describe('`toner`, `tinta`, `tambor` u `otro`. Puede recibir valores nuevos: trata cualquier otro como `otro`.'),
  color: z.string().nullable().describe('Color, si se conoce.'),
  rendimientoPaginas: z.number().int().positive().nullable().describe('Páginas que declara el fabricante, si se conocen.'),
});

export const publicCompatibleItemSchema = z.object({
  id: odooIdSchema.describe('Identificador del producto, el mismo que en `/inventory`.'),
  templateId: odooIdSchema.describe('Identificador del producto base que agrupa sus variantes.'),
  sku: z.string().nullable().describe('Referencia del producto. `null` si no tiene.'),
  nombre: z.string().describe('Nombre del producto.'),
  stock: stockStatusSchema.describe('Existencia en el almacén que te vende, igual que en `/inventory`. Puede recibir valores nuevos: trata cualquier otro como `agotado`.'),
  /**
   * `compatible` si CUALQUIERA de sus cartuchos lo es: llamar original a un
   * compatible engaña al cliente; lo contrario, como mucho, le hace pensar que
   * es más barato.
   */
  tipo: z.enum(['original', 'compatible']).describe('`original` si es el cartucho del fabricante; `compatible` si lo sustituye.'),
  cartuchos: z.array(publicCartridgeSchema).describe('Los cartuchos de esta impresora a los que corresponde el producto.'),
});

export type PublicCompatibleItem = z.infer<typeof publicCompatibleItemSchema>;

export const publicCompatibleResponseSchema = z.object({
  data: z.array(publicCompatibleItemSchema).describe('Productos compatibles: primero los que hay en existencia.'),
  meta: z.object({
    impresora: publicPrinterSchema,
    /**
     * La impresora existe pero todavía no tiene NINGUNA compatibilidad
     * validada. Son dos mensajes distintos para el cliente: "no encontramos tu
     * impresora" y "aún no sabemos qué le sirve".
     */
    sinCompatibilidadesCargadas: z.boolean().describe('`true` si todavía no hay compatibilidades verificadas para esta impresora. No significa que no exista tóner para ella.'),
    desdeCache: z.boolean().describe('`true` si la respuesta sale de la cache: puede tener hasta 60 segundos de antigüedad.'),
  }),
});

export type PublicCompatibleResponse = z.infer<typeof publicCompatibleResponseSchema>;

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
  /** `printer_models.id`, de MySQL. */
  matchedPrinterId: z.number().int().positive().nullable(),
  resultsCount: z.number().int().nonnegative(),
  clickedProductId: odooIdSchema.nullable(),
  /** Quiebre de venta medible: había producto compatible pero sin existencias. */
  wasOutOfStock: z.boolean().default(false),
});

export type RecommendationEvent = z.infer<typeof recommendationEventSchema>;
