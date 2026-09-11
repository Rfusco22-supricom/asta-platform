import { z } from 'zod';

/**
 * Sesiones activas de un usuario (issue #52).
 *
 * Es la pantalla que responde a "¿alguien más está dentro de mi cuenta?". Sin
 * ella, la detección de reuso de refresh tokens funciona pero es invisible: el
 * sistema revoca la familia entera de sesiones y el usuario solo ve que le han
 * echado, sin saber por qué ni desde dónde.
 *
 * ── Lo que NO se expone, y por qué ───────────────────────────────────────────
 *
 * Nunca sale el `refresh_token_hash`. Es el único secreto de la tabla, y aunque
 * un hash no sea el token, publicarlo permite confirmar un token robado por
 * comparación. La fila que viaja al panel lleva solo lo que sirve para que una
 * persona reconozca —o no reconozca— un dispositivo.
 */

/**
 * Familia de dispositivo deducida del user-agent.
 *
 * Se deduce en el servidor y no se manda el user-agent crudo. Dos razones: la
 * cadena real es ilegible para cualquiera que no sea programador, y es un dato
 * que el cliente controla —puede contener cualquier cosa, incluido HTML— así
 * que reducirla a un conjunto cerrado aquí evita tener que desconfiar de ella
 * en la vista.
 */
export const tipoDispositivoSchema = z.enum(['movil', 'tablet', 'escritorio', 'desconocido']);
export type TipoDispositivo = z.infer<typeof tipoDispositivoSchema>;

export const sesionActivaSchema = z.object({
  id: z.uuid(),
  /** Ej. "Chrome en Windows". Deducido, nunca el user-agent crudo. */
  dispositivo: z.string(),
  tipo: tipoDispositivoSchema,
  /**
   * IP desde la que se abrió.
   *
   * Se enseña entera a propósito. Es de quien mira su propia cuenta, y
   * recortarla ("190.x.x.x") destruiría justo lo que la hace útil: distinguir
   * "esto es mi oficina" de "esto no lo reconozco".
   */
  ip: z.string().nullable(),
  iniciadaEn: z.iso.datetime(),
  ultimoUsoEn: z.iso.datetime().nullable(),
  expiraEn: z.iso.datetime(),
  /** true para la sesión desde la que se está mirando la pantalla. */
  esActual: z.boolean(),
});

export type SesionActiva = z.infer<typeof sesionActivaSchema>;

export const sesionesRespuestaSchema = z.object({
  data: z.array(sesionActivaSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    /** Cuántas hay además de la actual. Es lo que decide si el botón de cerrar las demás tiene sentido. */
    otras: z.number().int().nonnegative(),
  }),
});
