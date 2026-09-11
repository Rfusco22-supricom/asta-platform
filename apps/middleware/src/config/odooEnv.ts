import { z } from 'zod';
import './dotenv.js';
import { odooEnvSchema } from './odooSchema.js';

/**
 * Configuración de Odoo, aislada del resto del entorno.
 *
 * Existe separada de `env.ts` a propósito. Un módulo solo debe exigir lo que de
 * verdad usa: el cliente de Odoo no necesita saber nada de MySQL ni del pepper
 * de las API keys, y atarlo a la validación completa hace imposible correr un
 * script de diagnóstico sin tener medio sistema montado. En Fase 0 eso impidió
 * ejecutar el `odoo-probe`.
 *
 * Este módulo SÍ es ansioso: valida al importarse y lanza. Los otros dos son
 * perezosos. Por eso el schema vive en `odooSchema.ts` — para que el
 * comprobador de entorno (#9) pueda leer su forma sin disparar esta comprobación
 * y perder la lista completa de lo que falta.
 */

const parsed = odooEnvSchema.safeParse(process.env);

if (!parsed.success) {
  // El detalle va DENTRO del Error, no solo por console.error: quien lo captura
  // arriba necesita saber qué variable falta, no leer "revisa el .env".
  throw new Error('Configuración de Odoo inválida:\n' + z.prettifyError(parsed.error));
}

/** Re-exportado por comodidad: el schema en sí vive en `odooSchema.ts`. */
export { odooEnvSchema };

export const odooEnv = parsed.data;
export type OdooEnv = typeof odooEnv;
