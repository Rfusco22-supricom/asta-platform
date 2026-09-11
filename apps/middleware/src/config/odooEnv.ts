import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Configuración de Odoo, aislada del resto del entorno.
 *
 * Existe separada de `env.ts` a propósito. `env.ts` valida TODO lo que el
 * servidor necesita para arrancar —Postgres, Supabase, el pepper— y mata el
 * proceso si falta algo. Eso está bien para el servidor.
 *
 * Pero el módulo de Odoo no necesita nada de eso, y atarlo a la validación
 * completa hace imposible probarlo o correr un script de diagnóstico sin tener
 * medio sistema montado. En Fase 0 eso significó no poder ejecutar el probe; en
 * Fase 3 significaría no poder verificar los servicios de facturación contra
 * Odoo hasta tener Supabase listo.
 *
 * Un módulo solo debe exigir lo que de verdad usa.
 */

/** dotenv mínimo, sin dependencias. No pisa lo que ya venga del entorno. */
function loadDotenv(): void {
  for (const candidate of ['.env', '../../.env', '../../../.env']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), candidate), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;
        const [, key, value] = match;
        if (process.env[key] === undefined) {
          process.env[key] = value.trim().replace(/^["']|["']$/g, '');
        }
      }
      return;
    } catch {
      /* siguiente candidato */
    }
  }
}

loadDotenv();

const schema = z.object({
  ODOO_URL: z.url(),
  ODOO_DB: z.string().min(1),
  /** Login del usuario de servicio. `authenticate` necesita login + key, no solo la key. */
  ODOO_USERNAME: z.string().min(1),
  /** API key de Odoo, no la contraseña del usuario. */
  ODOO_PASSWORD: z.string().min(1),
  ODOO_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /**
   * A partir de cuantos ms una llamada a Odoo se registra como lenta (`warn`).
   *
   * Por debajo salen en `debug`, que en produccion no se imprime. Dos segundos
   * es lo que tarda la cartera completa; una llamada suelta que pase de ahi es
   * lo que merece mirarse.
   */
  ODOO_SLOW_RPC_MS: z.coerce.number().int().positive().default(2_000),
  ODOO_DEFAULT_LANG: z.string().default('es_MX'),
  ODOO_DEFAULT_TZ: z.string().default('America/Mexico_City'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración de Odoo inválida:');
  console.error(z.prettifyError(parsed.error));
  throw new Error('Faltan variables ODOO_* — revisa el .env');
}

export const odooEnv = parsed.data;
export type OdooEnv = typeof odooEnv;
