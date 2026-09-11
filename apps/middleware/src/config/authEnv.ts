import { z } from 'zod';

/**
 * Configuración de autenticación, aislada igual que `odooEnv`.
 *
 * Se evalúa de forma perezosa —la primera vez que alguien la pide— y no al
 * importar el módulo. Leerla al importar congela el valor antes de que el `.env`
 * o un test hayan podido ponerlo; ese error ya costó una depuración en #25 con
 * `DEV_AUTH_ENABLED`, y no hay motivo para repetirlo.
 */

const schema = z.object({
  /**
   * Clave de firma de los JWT. Mínimo 32 caracteres.
   *
   * Rotarla invalida todas las sesiones activas: los access tokens dejan de
   * verificar y los refresh tokens dejan de poder canjearse.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ISSUER: z.string().default('asta-middleware'),
  JWT_AUDIENCE: z.string().default('asta-panel'),
  /** Vida del access token. Corta a propósito: no se puede revocar. */
  JWT_ACCESS_TTL: z.string().default('15m'),
  /** Vida del refresh token, en días. Este sí se revoca desde la base. */
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * Parámetros de Argon2id.
   *
   * Los valores por defecto NO son el mínimo de OWASP (m=19456, t=2), que está
   * pensado para el hardware más lento posible. Medido en esta máquina, ese
   * mínimo se resuelve en 14 ms: demasiado barato, porque el coste de crackear
   * es proporcional al coste de calcular.
   *
   * m=65536 (64 MiB), t=3 da ~68 ms, que es imperceptible en un login y casi
   * cinco veces más caro para quien ataque un volcado de la tabla.
   *
   * OJO CON LA MEMORIA: son 64 MiB POR HASH EN CURSO. En un VPS pequeño, diez
   * logins simultáneos son 640 MiB. El rate limit del login (#51) no es solo
   * una defensa contra fuerza bruta: también es lo que acota ese pico. Si el
   * servidor va justo de RAM, baja esto antes que quitar el límite.
   */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(65536),
  ARGON2_ITERATIONS: z.coerce.number().int().min(1).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  /** Intentos fallidos consecutivos antes de bloquear la cuenta. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  /** Minutos de bloqueo tras agotar los intentos. */
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

export type AuthEnv = z.infer<typeof schema>;

let cache: AuthEnv | null = null;

export function authEnv(): AuthEnv {
  if (cache) return cache;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'Configuración de autenticación inválida:\n' + z.prettifyError(parsed.error),
    );
  }
  cache = parsed.data;
  return cache;
}

/** Solo para tests: fuerza releer el entorno. */
export function resetAuthEnvCache(): void {
  cache = null;
}
