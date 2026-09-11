import { z } from 'zod';

/**
 * Configuración general del servidor.
 *
 * Está dividida en tres archivos a propósito —`odooEnv`, `authEnv` y este— y no
 * en un único bloque que lo valide todo al arrancar. La razón es práctica: el
 * módulo de Odoo no necesita saber nada de la base de datos, y atarlos obligaba
 * a tener medio sistema montado para poder ejecutar un script de diagnóstico.
 * En Fase 0 eso impidió correr el `odoo-probe`.
 *
 * Cada módulo exige solo lo que usa.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.string().default('info'),

  /**
   * MySQL 8.0.13+ o MariaDB 10.4+.
   *
   * Ojo con los caracteres especiales de la contraseña: en un DSN la `@` separa
   * las credenciales del host, así que "Clave2015@" debe ir como "Clave2015%40".
   * Sin codificar, el error que devuelve Prisma no apunta a la contraseña.
   */
  DATABASE_URL: z.string().min(1),

  /**
   * Pepper del HMAC de las API keys. Vive SOLO aquí, nunca en la base: si se
   * filtra la tabla `api_keys`, los hashes sin el pepper no permiten verificar
   * ni un token. Rotarlo invalida todas las keys emitidas.
   */
  API_KEY_PEPPER: z.string().min(32),

  /** Origen del panel para CORS. La API pública se consume sin navegador. */
  WEB_APP_ORIGIN: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof schema>;

let cache: Env | null = null;

/** Perezosa, igual que `authEnv`: leer al importar congela el valor demasiado pronto. */
export function env(): Env {
  if (cache) return cache;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('Configuración de entorno inválida:\n' + z.prettifyError(parsed.error));
  }
  cache = parsed.data;
  return cache;
}

export function resetEnvCache(): void {
  cache = null;
}
