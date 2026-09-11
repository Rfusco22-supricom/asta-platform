import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga del `.env`, aislada de cualquier validación.
 *
 * Vivía dentro de `odooEnv.ts`, que además valida y MATA el proceso si algo
 * falta. Eso lo hacía inservible para el comprobador de entorno del issue #9:
 * importar `odooEnv` para leer su schema disparaba su propia comprobación al
 * cargarse, y la lista de variables que faltan se cortaba en el primer grupo.
 *
 * Aquí no se valida nada y no se lanza nunca. Solo se pone el `.env` en
 * `process.env` para que alguien más pueda mirarlo.
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
