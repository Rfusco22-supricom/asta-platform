import { z } from 'zod';
import { odooIdSchema } from './common.js';

/**
 * Revisión de compatibilidades en el panel (#56, Fase 3).
 *
 * El importador deja cada "este producto es o sustituye a este cartucho" como
 * PROPUESTA, y el recomendador (#39) solo sirve lo VALIDADO. Esta es la pantalla
 * donde una persona decide. Hasta que existió, la única forma de validar era
 * editar MySQL a mano, así que el recomendador no podía devolver nada.
 *
 * Solo el tramo producto → cartucho. El de cartucho → impresora llegará con el
 * catálogo de impresoras de los fabricantes (#56, Fase 2).
 */

export const estadoRevisionSchema = z.enum(['PROPUESTA', 'VALIDADA', 'RECHAZADA']);
export type EstadoRevision = z.infer<typeof estadoRevisionSchema>;

export const relacionProductoSchema = z.enum(['ORIGINAL', 'COMPATIBLE']);
export const tipoCartuchoSchema = z.enum(['TONER', 'TINTA', 'DRUM', 'OTRO']);
export const fuenteCompatibilidadSchema = z.enum(['FABRICANTE', 'PARSEO', 'MANUAL', 'BUSQUEDA']);

export const candidatoRevisionSchema = z.object({
  cartridgeId: z.number().int().positive(),
  marca: z.string(),
  codigo: z.string(),
  tipo: tipoCartuchoSchema,
  relacion: relacionProductoSchema,
  fuente: fuenteCompatibilidadSchema,
  /** El fragmento del nombre que justificó la propuesta. */
  evidencia: z.string().nullable(),
  estado: estadoRevisionSchema,
  revisadoPor: z.string().nullable(),
  revisadoEn: z.iso.datetime().nullable(),
});

export type CandidatoRevision = z.infer<typeof candidatoRevisionSchema>;

export const productoEnRevisionSchema = z.object({
  templateId: odooIdSchema,
  /** null si la plantilla ya no existe en Odoo: la fila se revisa igual, y se rechaza. */
  nombre: z.string().nullable(),
  sku: z.string().nullable(),
  /** Archivada o retirada de la venta en Odoo. */
  activoEnOdoo: z.boolean(),
  /** Importe vendido en los últimos 12 meses: lo que decide el orden. */
  ventas12m: z.number().nonnegative(),
  /** Todos los candidatos del producto, no solo los del filtro: los validados dan contexto. */
  candidatos: z.array(candidatoRevisionSchema),
});

export type ProductoEnRevision = z.infer<typeof productoEnRevisionSchema>;

export const revisionQuerySchema = z.object({
  estado: estadoRevisionSchema.default('PROPUESTA'),
  marca: z.string().min(1).max(60).optional(),
  q: z.string().trim().min(2).max(80).optional(),
  pagina: z.coerce.number().int().positive().default(1),
  porPagina: z.coerce.number().int().positive().max(100).default(25),
});

export type RevisionQuery = z.infer<typeof revisionQuerySchema>;

export const revisionRespuestaSchema = z.object({
  data: z.array(productoEnRevisionSchema),
  meta: z.object({
    pagina: z.number().int().positive(),
    porPagina: z.number().int().positive(),
    /** Productos con al menos un candidato en el estado filtrado. */
    totalProductos: z.number().int().nonnegative(),
    /** Filas de toda la tabla por estado, sin filtros: el avance de la revisión. */
    porEstado: z.object({ PROPUESTA: z.number().int(), VALIDADA: z.number().int(), RECHAZADA: z.number().int() }),
    marcas: z.array(z.string()),
  }),
});

export type RevisionRespuesta = z.infer<typeof revisionRespuestaSchema>;

/**
 * Una decisión sobre una o varias filas.
 *
 * `estadoEsperado` por fila: si otra persona la cambió mientras se miraba la
 * pantalla, la petición entera falla con 409 en vez de pisar su decisión.
 */
export const revisionDecisionSchema = z.object({
  filas: z
    .array(
      z.object({
        templateId: odooIdSchema.max(4_294_967_295),
        cartridgeId: z.number().int().positive().max(4_294_967_295),
        estadoEsperado: estadoRevisionSchema,
      }),
    )
    .min(1)
    .max(100),
  decision: estadoRevisionSchema,
  /** Corrige original/compatible a la vez que se decide. Solo con una fila. */
  relacion: relacionProductoSchema.optional(),
});

export type RevisionDecision = z.infer<typeof revisionDecisionSchema>;

export const revisionDecisionRespuestaSchema = z.object({
  data: z.object({ actualizadas: z.number().int().nonnegative() }),
});

export const tipoCartuchoCambioSchema = z.object({ tipo: tipoCartuchoSchema });
