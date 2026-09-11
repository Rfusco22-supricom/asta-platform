import { readFileSync } from 'node:fs';
import {
  describirProblemas,
  resumirEntorno,
} from '../apps/middleware/src/config/validarEntorno.js';
import { envSchema } from '../apps/middleware/src/config/env.js';
import { odooEnvSchema } from '../apps/middleware/src/config/odooSchema.js';
import { authEnvSchema } from '../apps/middleware/src/config/authEnv.js';

/**
 * `pnpm check:env` — revisa el entorno sin arrancar nada (issue #9).
 *
 * Sirve para dos momentos: antes de desplegar, y cuando a alguien del equipo no
 * le arranca el middleware y hay que saber por qué sin leer un stack trace.
 */

/**
 * Segunda mitad: que `.env.example` no se quede atrás.
 *
 * El issue lo pedía explícitamente, y no es burocracia. `.env.example` es lo
 * único que tiene delante quien monta el proyecto por primera vez o quien lo
 * despliega. Una variable que existe en el schema y no aparece ahí es una que
 * nadie sabe que hay que poner hasta que el arranque falla — y ya pasó con
 * `LOG_LEVEL`.
 *
 * Se comprueba aquí y no en un test porque es una condición del repositorio, no
 * del código: interesa verla al desplegar, no al correr la batería.
 */
function variablesSinDocumentar(): string[] {
  const ejemplo = readFileSync('.env.example', 'utf8');

  const declaradas = new Set<string>();
  for (const schema of [envSchema, odooEnvSchema, authEnvSchema]) {
    for (const clave of Object.keys(schema.shape)) declaradas.add(clave);
  }

  return [...declaradas].filter((clave) => !new RegExp('^' + clave + '=', 'm').test(ejemplo));
}

const { ok, problemas } = resumirEntorno();
const sinDocumentar = variablesSinDocumentar();

if (!ok) console.error(describirProblemas(problemas));

if (sinDocumentar.length > 0) {
  console.error('\n  Variables que los schemas exigen y .env.example no menciona:\n');
  for (const variable of sinDocumentar) console.error(`    · ${variable}`);
  console.error('\n  Quien despliegue no tiene forma de saber que existen.\n');
}

if (ok && sinDocumentar.length === 0) {
  console.log('\n  Entorno correcto, y .env.example al día con los tres schemas.\n');
  process.exit(0);
}

process.exit(1);
