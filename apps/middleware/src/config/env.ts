import { z } from 'zod';

/**
 * Validación de entorno al arrancar. Si falta una variable, el proceso muere en
 * el segundo 0 con un mensaje claro — no a las 3 a.m. con un `undefined` en un RPC.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // ── Odoo ──────────────────────────────────────────────────────────────────
  ODOO_URL: z.string().url(),
  ODOO_DB: z.string().min(1),
  /** Usuario de SERVICIO, no `admin`. Solo lectura salvo donde haga falta escribir. */
  ODOO_USERNAME: z.string().min(1),
  /** API key de Odoo (Preferencias > Seguridad de la cuenta), no la contraseña. */
  ODOO_PASSWORD: z.string().min(1),
  ODOO_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  ODOO_DEFAULT_LANG: z.string().default('es_MX'),
  ODOO_DEFAULT_TZ: z.string().default('America/Mexico_City'),

  // ── Base de datos ─────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // ── Seguridad ─────────────────────────────────────────────────────────────
  /**
   * Pepper para el HMAC de las API keys. 32+ bytes aleatorios.
   * Vive SOLO en el entorno: si se filtra la tabla api_keys, los hashes sin el
   * pepper no permiten verificar ni un token.
   * Rotarlo invalida todas las keys emitidas (requiere reemisión).
   */
  API_KEY_PEPPER: z.string().min(32),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  /** Origen del panel Next.js para CORS. La API pública se sirve sin CORS. */
  WEB_APP_ORIGIN: z.string().url(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración de entorno inválida:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
