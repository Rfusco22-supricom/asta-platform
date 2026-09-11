import './dotenv.js';
import { envSchema } from './env.js';
import { odooEnvSchema } from './odooSchema.js';
import { authEnvSchema } from './authEnv.js';

/**
 * Comprobación del entorno al arrancar (issue #9).
 *
 * ── Por qué existe, si cada módulo ya se valida solo ─────────────────────────
 *
 * Porque `env` y `authEnv` son PEREZOSOS, y eso es deliberado: el `odoo-probe`
 * no tiene por qué exigir credenciales de MySQL para correr, y en Fase 0 atarlo
 * todo a un único bloque impidió justamente eso. (`odooEnv` sí es ansioso.)
 *
 * Pero lo perezoso tiene un precio: sin esto, un `API_KEY_PEPPER` ausente no se
 * descubre al arrancar sino la primera vez que alguien usa una API key, que es
 * por definición el peor momento. El servidor arranca, parece sano, y falla más
 * tarde. Esta función recupera el arranque-o-nada SOLO para el servidor, y deja
 * a los scripts su libertad.
 *
 * ── Se acumulan TODOS los fallos ─────────────────────────────────────────────
 *
 * Deliberado. Parar en el primero obliga a la peor rutina que hay: corriges una
 * variable, reinicias, aparece la siguiente, reinicias. Con diez variables mal
 * son diez ciclos. Aquí salen las diez a la vez.
 *
 * Por eso se parsean los SCHEMAS y no se importan los módulos: importar
 * `odooEnv` dispara su propia comprobación al cargarse y cortaría la lista en
 * el primer grupo que falle.
 */

export interface ProblemaEntorno {
  /** Qué bloque de configuración: 'servidor', 'odoo' o 'autenticación'. */
  grupo: string;
  /** Nombre de la variable, tal cual se escribe en el `.env`. */
  variable: string;
  detalle: string;
}

const GRUPOS = [
  { grupo: 'servidor', schema: envSchema },
  { grupo: 'odoo', schema: odooEnvSchema },
  { grupo: 'autenticación', schema: authEnvSchema },
] as const;

/**
 * Revisa el entorno entero sin lanzar.
 *
 * @param fuente normalmente `process.env`; se inyecta para poder probarlo.
 */
export function revisarEntorno(
  fuente: Record<string, string | undefined> = process.env,
): ProblemaEntorno[] {
  const problemas: ProblemaEntorno[] = [];

  for (const { grupo, schema } of GRUPOS) {
    const parsed = schema.safeParse(fuente);
    if (parsed.success) continue;

    for (const issue of parsed.error.issues) {
      problemas.push({
        grupo,
        // `path` es la ruta del campo; para variables de entorno es un solo
        // segmento, que es el nombre de la variable.
        variable: issue.path.join('.') || '(desconocida)',
        detalle: issue.message,
      });
    }
  }

  return problemas;
}

/** Texto para consola. Una línea por variable, sin traza. */
export function describirProblemas(problemas: ProblemaEntorno[]): string {
  const lineas = problemas.map((p) => `  · ${p.variable} [${p.grupo}] — ${p.detalle}`);

  return [
    '',
    'No se puede arrancar: faltan variables de entorno o están mal.',
    '',
    ...lineas,
    '',
    `${problemas.length} ${problemas.length === 1 ? 'problema' : 'problemas'}.`,
    'Compara tu .env con .env.example. Están todas ahí, con su explicación.',
    '',
  ].join('\n');
}

/**
 * Comprueba el entorno y mata el proceso si algo falta.
 *
 * Imprime la lista y sale con código 1. SIN traza de pila: una traza aquí no
 * dice nada útil —el fallo no está en el código, está en el `.env`— y entierra
 * la única línea que importa, que es el nombre de la variable.
 */
export function exigirEntornoValido(
  fuente: Record<string, string | undefined> = process.env,
): void {
  const problemas = revisarEntorno(fuente);
  if (problemas.length === 0) return;

  console.error(describirProblemas(problemas));
  process.exit(1);
}

/** Solo para el reporte de `pnpm check:env`, que no debe matar el proceso. */
export function resumirEntorno(fuente: Record<string, string | undefined> = process.env): {
  ok: boolean;
  problemas: ProblemaEntorno[];
} {
  const problemas = revisarEntorno(fuente);
  return { ok: problemas.length === 0, problemas };
}
