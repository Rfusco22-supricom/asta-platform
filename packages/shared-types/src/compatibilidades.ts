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

// ─────────────────────────────────────────────────────────────────────────────
// Tramo impresora → cartucho (pestaña «Impresoras»)
// ─────────────────────────────────────────────────────────────────────────────

/** Una impresora a la que sirve el cartucho, con el estado de esa relación. */
export const impresoraEnRevisionSchema = z.object({
  printerModelId: z.number().int().positive(),
  marca: z.string(),
  nombre: z.string(),
  estado: estadoRevisionSchema,
  fuente: fuenteCompatibilidadSchema,
  /** La fila de `compatibilidad_productos` de la que salió, con su texto original. */
  origen: z.string().nullable(),
  propuestaPor: z.string().nullable(),
  revisadoPor: z.string().nullable(),
  revisadoEn: z.iso.datetime().nullable(),
});

export type ImpresoraEnRevision = z.infer<typeof impresoraEnRevisionSchema>;

export const cartuchoEnRevisionSchema = z.object({
  cartridgeId: z.number().int().positive(),
  marca: z.string(),
  codigo: z.string(),
  tipo: tipoCartuchoSchema,
  color: z.string().nullable(),
  rendimientoPaginas: z.number().int().positive().nullable(),
  /** Productos de Odoo que lo venden, VALIDADOS. Sin ninguno, el kiosco no tiene qué ofrecer. */
  productosValidados: z.number().int().nonnegative(),
  productosPendientes: z.number().int().nonnegative(),
  /** Ventas de 12 meses de sus productos (cualquier estado): decide el orden. */
  ventas12m: z.number().nonnegative(),
  impresoras: z.array(impresoraEnRevisionSchema),
});

export type CartuchoEnRevision = z.infer<typeof cartuchoEnRevisionSchema>;

export const revisionImpresorasQuerySchema = revisionQuerySchema;

export const revisionImpresorasRespuestaSchema = z.object({
  data: z.array(cartuchoEnRevisionSchema),
  meta: z.object({
    pagina: z.number().int().positive(),
    porPagina: z.number().int().positive(),
    totalCartuchos: z.number().int().nonnegative(),
    porEstado: z.object({ PROPUESTA: z.number().int(), VALIDADA: z.number().int(), RECHAZADA: z.number().int() }),
    marcas: z.array(z.string()),
  }),
});

export type RevisionImpresorasRespuesta = z.infer<typeof revisionImpresorasRespuestaSchema>;

export const revisionImpresorasDecisionSchema = z.object({
  filas: z
    .array(
      z.object({
        cartridgeId: z.number().int().positive().max(4_294_967_295),
        printerModelId: z.number().int().positive().max(4_294_967_295),
        estadoEsperado: estadoRevisionSchema,
      }),
    )
    .min(1)
    .max(100),
  decision: estadoRevisionSchema,
});

export type RevisionImpresorasDecision = z.infer<typeof revisionImpresorasDecisionSchema>;

/**
 * Añadir una compatibilidad desde el panel: «a esta impresora le sirve este
 * cartucho». Crea la impresora y el cartucho si no existen.
 *
 * El ESTADO no viaja en la petición: lo decide la ruta. La del administrador
 * la crea VALIDADA; la del vendedor, PROPUESTA. Un campo `estado` en el cuerpo
 * es justo lo que alguien acaba mandando con el valor que no debía.
 */
export const nuevaCompatibilidadSchema = z.object({
  marcaImpresora: z.string().trim().min(2).max(60),
  modeloImpresora: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine((s) => /\d/.test(s), 'El modelo tiene que llevar su número: «LaserJet Pro M404», no «LaserJet Pro».'),
  codigoCartucho: z.string().trim().min(2).max(40),
  /** Si no se indica, la misma que la impresora. */
  marcaCartucho: z.string().trim().min(2).max(60).optional(),
  tipo: tipoCartuchoSchema.default('TONER'),
});

export type NuevaCompatibilidad = z.infer<typeof nuevaCompatibilidadSchema>;

export const nuevaCompatibilidadRespuestaSchema = z.object({
  data: z.object({
    cartridgeId: z.number().int().positive(),
    printerModelId: z.number().int().positive(),
    estado: estadoRevisionSchema,
    /** false si esa compatibilidad ya existía: no se toca su estado. */
    creada: z.boolean(),
    impresoraNueva: z.boolean(),
    cartuchoNuevo: z.boolean(),
  }),
});

export type NuevaCompatibilidadRespuesta = z.infer<typeof nuevaCompatibilidadRespuestaSchema>;

/** Lo que un vendedor ve de lo que ha propuesto. */
export const propuestaPropiaSchema = z.object({
  cartridgeId: z.number().int().positive(),
  printerModelId: z.number().int().positive(),
  marcaImpresora: z.string(),
  modeloImpresora: z.string(),
  marcaCartucho: z.string(),
  codigoCartucho: z.string(),
  estado: estadoRevisionSchema,
  creadaEn: z.iso.datetime(),
  revisadoEn: z.iso.datetime().nullable(),
});

export const propuestasPropiasRespuestaSchema = z.object({ data: z.array(propuestaPropiaSchema) });

export type PropuestaPropia = z.infer<typeof propuestaPropiaSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Alias de impresora desde el panel (#43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que alguien tecleó en el kiosco y no encontró nada, atado a la impresora que
 * buscaba. Es la forma de que el recomendador aprenda de sus propios fallos: la
 * lista de búsquedas sin resultado (#43) es justo la lista de alias que faltan.
 */
export const nuevoAliasSchema = z.object({
  printerModelId: z.number().int().positive().max(4_294_967_295),
  /** El texto tal cual se buscó. Se normaliza al guardarlo, igual que la búsqueda. */
  alias: z.string().trim().min(2).max(120),
});

export type NuevoAlias = z.infer<typeof nuevoAliasSchema>;

export const nuevoAliasRespuestaSchema = z.object({
  data: z.object({
    printerModelId: z.number().int().positive(),
    alias: z.string(),
    /** false si ese alias ya existía en esa impresora: no se duplica ni se reactiva. */
    creado: z.boolean(),
    /** Ya estaba, pero desactivado: alguien lo retiró por equivocar al cliente. */
    estabaDesactivado: z.boolean(),
  }),
});

const impresoraElegibleSchema = z.object({
  printerModelId: z.number().int().positive(),
  marca: z.string(),
  nombre: z.string(),
  /**
   * false mientras no tenga ninguna compatibilidad VALIDADA: el kiosco no la
   * enseña (#111/#112), así que un alias sobre ella todavía no arregla nada.
   */
  visibleEnKiosco: z.boolean(),
});

/** Impresoras que coinciden con lo tecleado, para elegir a cuál atar el alias. */
export const busquedaImpresorasRespuestaSchema = z.object({
  data: z.array(impresoraElegibleSchema),
  /** Solo si no hubo coincidencias: los parecidos, para preguntar. */
  sugerencias: z.array(impresoraElegibleSchema),
});

export type BusquedaImpresorasRespuesta = z.infer<typeof busquedaImpresorasRespuestaSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cobertura del top de ventas (#56, Fase 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué le falta a un producto para que el kiosco pueda recomendarlo:
 *
 *   · `sin_cartucho`  nadie ha validado qué cartucho es → la pestaña Productos
 *   · `sin_impresora` el cartucho está, pero ninguna impresora validada lo usa
 *                     → la pestaña Impresoras
 *   · `completo`      la cadena entera: impresora → cartucho → producto
 */
export const estadoCoberturaSchema = z.enum(['completo', 'sin_cartucho', 'sin_impresora']);
export type EstadoCobertura = z.infer<typeof estadoCoberturaSchema>;

export const coberturaTopSchema = z.object({
  productos: z.array(
    z.object({
      templateId: odooIdSchema,
      nombre: z.string().nullable(),
      sku: z.string().nullable(),
      ventas12m: z.number().nonnegative(),
      estado: estadoCoberturaSchema,
      /**
       * Códigos de sus cartuchos ya validados. Con `sin_impresora` son por dónde
       * seguir: lo que falta se arregla buscando EL CARTUCHO en la pestaña de
       * impresoras, no la referencia del producto, que allí no encuentra nada.
       */
      cartuchos: z.array(z.string()),
    }),
  ),
  totales: z.object({
    top: z.number().int().nonnegative(),
    completos: z.number().int().nonnegative(),
    /** Por PRODUCTOS, como fija el umbral de #7, no por importe. */
    porcentaje: z.number().int().min(0).max(100),
    /** El tramo de #7 ya aplicado: `> 85` procede, `60–85` con respaldo, `< 60` pospuesta. */
    tramo: z.enum(['procede', 'con_respaldo', 'pospuesta']),
    importeTop: z.number().nonnegative(),
    importeCubierto: z.number().nonnegative(),
  }),
});

export type CoberturaTop = z.infer<typeof coberturaTopSchema>;

export const coberturaTopRespuestaSchema = z.object({ data: coberturaTopSchema });
