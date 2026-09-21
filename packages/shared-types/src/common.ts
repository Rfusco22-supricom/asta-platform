import { z } from 'zod';

/**
 * Envoltorio de respuesta y errores. Todo endpoint del middleware responde con
 * una de estas dos formas, sin excepción.
 *
 * Que la forma sea invariable es lo que permite al frontend tener un solo
 * cliente HTTP con un solo manejo de errores. En cuanto un endpoint devuelve
 * "algo distinto porque era más cómodo", cada pantalla empieza a inventar su
 * propio parseo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unión cerrada a propósito: el frontend puede hacer un `switch` exhaustivo y
 * el compilador le avisa cuando añadimos un código nuevo que no está manejando.
 * Con `string` suelto, un código nuevo se convierte en un mensaje genérico que
 * nadie nota hasta que un usuario se queja.
 */
export const errorCodeSchema = z.enum([
  // Autenticación
  'UNAUTHENTICATED',
  'MISSING_API_KEY',
  'INVALID_API_KEY',
  'TOKEN_EXPIRED',

  // Autorización
  'ROLE_NOT_ALLOWED',
  'INSUFFICIENT_SCOPE',
  'PARTNER_NOT_IN_PORTFOLIO',
  /**
   * API pública: `partner_id` de otro cliente en la query o el cuerpo (#36).
   * 400 y no 403, decidido en la revisión de #36: la key no "carece de permiso"
   * sobre otro cliente, es que ese parámetro no tiene sentido con una API key.
   */
  'PARTNER_ID_NOT_ALLOWED',

  // Entrada
  'VALIDATION_ERROR',
  'INVALID_QUERY',
  'INVALID_PARTNER_ID',
  'INVALID_DATE_RANGE',
  /** `:id` de factura que no es un entero positivo. */
  'INVALID_INVOICE_ID',

  // Recursos
  'NOT_FOUND',
  'PARTNER_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'PRINTER_NOT_FOUND',
  /** Factura inexistente O de otro cliente: la misma respuesta a propósito (#36). */
  'INVOICE_NOT_FOUND',
  /**
   * La factura es del cliente pero no tiene un PDF que se pueda servir (#32).
   * Unas 4.500 de 17.180 no tienen ninguno guardado en Odoo.
   */
  'INVOICE_PDF_NOT_AVAILABLE',
  /** Enlace de descarga con firma inválida, o que ya no autoriza nada (#32). */
  'LINK_NOT_VALID',
  /**
   * Enlace de descarga caducado (#32). 410 y no 404: a quien tiene un enlace
   * legítimo le dice que pida otro, y no revela nada que el token no diga ya.
   */
  'LINK_EXPIRED',
  /**
   * La búsqueda del recomendador no existe, es de otro cliente o pasaron más de
   * 30 minutos (#43). La misma respuesta para los tres, a propósito.
   */
  'SEARCH_NOT_FOUND',

  // Conflicto
  'CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  /**
   * El cliente no tiene un almacén desde el que se le venda (#30).
   *
   * No es NOT_FOUND —el catálogo existe— ni un catálogo entero en "agotado",
   * que sería una respuesta verosímil y falsa. Es que a esa cuenta todavía no
   * se le puede decir nada cierto sobre existencias.
   */
  'INVENTORY_UNAVAILABLE',

  // Límites
  'RATE_LIMITED',

  // Infraestructura
  'ODOO_UNAVAILABLE',
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Mensaje legible. Nunca filtra detalles internos del ERP ni stack traces. */
    message: z.string(),
    /** Scopes o campos que faltaban, según el código. */
    required: z.array(z.string()).optional(),
    /** Documentación del error, cuando existe. */
    docs: z.string().url().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** Mapeo canónico código -> HTTP. Evita que cada controlador elija su propio status. */
export const HTTP_STATUS_BY_ERROR: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  MISSING_API_KEY: 401,
  INVALID_API_KEY: 401,
  TOKEN_EXPIRED: 401,

  ROLE_NOT_ALLOWED: 403,
  INSUFFICIENT_SCOPE: 403,
  PARTNER_NOT_IN_PORTFOLIO: 403,
  PARTNER_ID_NOT_ALLOWED: 400,

  VALIDATION_ERROR: 400,
  INVALID_QUERY: 400,
  INVALID_PARTNER_ID: 400,
  INVALID_DATE_RANGE: 400,
  INVALID_INVOICE_ID: 400,

  NOT_FOUND: 404,
  PARTNER_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  PRINTER_NOT_FOUND: 404,
  INVOICE_NOT_FOUND: 404,
  INVOICE_PDF_NOT_AVAILABLE: 404,
  LINK_NOT_VALID: 404,
  LINK_EXPIRED: 410,
  SEARCH_NOT_FOUND: 404,

  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVENTORY_UNAVAILABLE: 409,

  RATE_LIMITED: 429,

  ODOO_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
};

// ─────────────────────────────────────────────────────────────────────────────
// Respuestas correctas
// ─────────────────────────────────────────────────────────────────────────────

export const responseMetaSchema = z.object({
  /** De dónde salió el dato: "odoo:account.move", "cache", "postgres". */
  fuente: z.string().optional(),
  /** Criterio de cálculo aplicado, cuando hay más de uno posible. */
  criterio: z.string().optional(),
  consultadoEn: z.iso.datetime().optional(),
  /** true si la respuesta vino de cache y puede estar desactualizada. */
  desdeCache: z.boolean().optional(),
});

export type ResponseMeta = z.infer<typeof responseMetaSchema>;

/**
 * Construye el schema de una respuesta correcta.
 *
 * @example
 *   const resp = successSchema(partnerSchema);
 *   type Resp = z.infer<typeof resp>;   // { data: Partner; meta?: ResponseMeta }
 */
export function successSchema<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    meta: responseMetaSchema.optional(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Paginación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginación por cursor, no por offset.
 *
 * Con offset, insertar una factura mientras alguien pagina le hace ver un
 * registro dos veces o saltárselo. Además `OFFSET 10000` obliga a Postgres a
 * recorrer 10.000 filas para descartarlas.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: responseMetaSchema
      .extend({
        total: z.number().int().nonnegative().optional(),
        siguienteCursor: z.string().nullable(),
        hayMas: z.boolean(),
      })
      .optional(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos primitivos del dominio
// ─────────────────────────────────────────────────────────────────────────────

/** ID de un registro de Odoo. Entero positivo, siempre. */
export const odooIdSchema = z.number().int().positive();
export type OdooId = z.infer<typeof odooIdSchema>;

/** Fecha sin hora, como la devuelve Odoo: "2026-09-11". */
export const odooDateSchema = z.iso.date();

/**
 * Importe monetario.
 *
 * Es `number` porque Odoo devuelve float por XML-RPC y convertirlo a decimal en
 * cada frontera sería más ruido que beneficio. El middleware lo redondea a 2
 * decimales antes de responder.
 *
 * REGLA: úsalo para mostrar, nunca para acumular en el cliente. Sumar importes
 * en JavaScript acumula error de coma flotante. Si necesitas un total, pídeselo
 * al backend — allí lo calcula Postgres vía read_group.
 */
export const montoSchema = z.number();
