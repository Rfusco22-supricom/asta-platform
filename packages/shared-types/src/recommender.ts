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

/**
 * Identificador de una búsqueda (#43). Texto y no número: es un BIGINT, y en
 * JSON un entero de ese tamaño pierde precisión.
 */
export const busquedaIdSchema = z.string().regex(/^[1-9]\d{0,18}$/, 'busquedaId tiene que ser el que devolvió la búsqueda.');

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
  meta: z.object({
    busquedaId: busquedaIdSchema
      .nullable()
      .describe('Identificador de esta búsqueda. Mándalo en `/compatible` y al registrar un clic, para que la búsqueda, la impresora elegida y el producto elegido cuenten como una sola visita. `null` si no se pudo registrar: la búsqueda funciona igual.'),
  }),
});

export type PublicPrinterSearchResponse = z.infer<typeof publicPrinterSearchResponseSchema>;

/** Query de `GET /api/v1/public/recommender/printers/{printerId}/compatible`. */
export const compatibleQuerySchema = z.object({
  soloDisponibles: z.stringbool().default(false).describe('`true` para devolver solo productos con existencia (`disponible` o `bajo`).'),
  busquedaId: busquedaIdSchema.optional().describe('El `meta.busquedaId` de la búsqueda de la que viene el cliente, si la hubo.'),
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
    sinCompatibilidadesCargadas: z.boolean().describe('`true` si se sabe qué cartuchos usa la impresora pero todavía no hay ningún producto verificado para ellos. No significa que no exista tóner para ella.'),
    desdeCache: z.boolean().describe('`true` si la respuesta sale de la cache: puede tener hasta 60 segundos de antigüedad.'),
  }),
});

export type PublicCompatibleResponse = z.infer<typeof publicCompatibleResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Telemetría (issue #43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La búsqueda, sus resultados, la impresora elegida y si estaba agotado los
 * registra el SERVIDOR al responder: no se pueden falsear. Solo el clic lo avisa
 * el cliente, porque ocurre en su pantalla. Ver `telemetria.service.ts`.
 */
export const busquedaIdParamSchema = z.object({ busquedaId: busquedaIdSchema });

/** Cuerpo de `POST /api/v1/public/recommender/busquedas/{busquedaId}/clic`. */
export const clicRecomendadorSchema = z.object({
  productId: odooIdSchema.describe('El `id` del producto que eligió el cliente, tal como vino en `/compatible`.'),
});

export type ClicRecomendador = z.infer<typeof clicRecomendadorSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Estadísticas del recomendador para el panel (issue #43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que sale de `recommendation_events` para el dashboard del SuperAdmin.
 *
 * Es de uso interno, no de la API pública: por eso lleva ids de impresora y de
 * producto sin más contexto que el nombre.
 */
export const estadisticasRecomendadorSchema = z.object({
  desde: z.iso.date(),
  hasta: z.iso.date(),
  totales: z.object({
    /** Búsquedas por texto. No incluye las consultas directas. */
    busquedas: z.number().int().nonnegative(),
    /** Búsquedas que no encontraron ninguna impresora: la lista de alias que faltan. */
    sinResultado: z.number().int().nonnegative(),
    /** Búsquedas en las que se llegó a elegir impresora. */
    conImpresora: z.number().int().nonnegative(),
    /** Búsquedas que terminaron en el clic de un producto. */
    conClic: z.number().int().nonnegative(),
    /** Visitas con productos compatibles y ninguno en existencia: ventas perdidas. */
    quiebres: z.number().int().nonnegative(),
    /** Consultas de compatibles sin búsqueda previa: integraciones que ya sabían su impresora. */
    consultasDirectas: z.number().int().nonnegative(),
  }),
  /**
   * Agrupadas por su forma normalizada ("HL-2350" y "hl 2350" son la misma), con
   * el texto más frecuente como ejemplo: es el alias que habría que añadir.
   */
  sinResultado: z.array(
    z.object({
      normalizada: z.string(),
      ejemplo: z.string(),
      /**
       * Textos distintos que cayeron en el grupo, SIN contar mayúsculas: la
       * colación de MySQL ya junta "epson l999" y "Epson L999" al agrupar.
       */
      variantes: z.number().int().positive(),
      veces: z.number().int().positive(),
      ultimaVez: z.iso.datetime(),
    }),
  ),
  impresoras: z.array(
    z.object({
      printerModelId: z.number().int().positive(),
      marca: z.string().nullable(),
      nombre: z.string().nullable(),
      veces: z.number().int().positive(),
      quiebres: z.number().int().nonnegative(),
    }),
  ),
  productos: z.array(
    z.object({
      productId: odooIdSchema,
      /** null si Odoo no respondió: el resto del informe sale igual. */
      nombre: z.string().nullable(),
      sku: z.string().nullable(),
      clics: z.number().int().positive(),
    }),
  ),
});

export type EstadisticasRecomendador = z.infer<typeof estadisticasRecomendadorSchema>;

export const estadisticasRecomendadorRespuestaSchema = z.object({ data: estadisticasRecomendadorSchema });
