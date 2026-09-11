import { z } from 'zod';

/**
 * Forma del entorno de Odoo, SIN efectos de carga.
 *
 * Separado de `odooEnv.ts` porque ese módulo valida y lanza al importarse. El
 * comprobador de entorno (#9) necesita poder leer esta forma sin disparar esa
 * comprobación, o no podría acumular los fallos de los tres bloques a la vez.
 */

export const odooEnvSchema = z.object({
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
