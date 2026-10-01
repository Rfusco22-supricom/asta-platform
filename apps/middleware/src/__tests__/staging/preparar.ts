import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { comprobarStaging } from '../../odoo/entornoStaging.js';

/**
 * Arranque de la batería de staging (#13). Corre antes que cualquier test.
 *
 * Carga `.env.staging` PISANDO lo que haya en el entorno: si la shell trae el
 * Odoo de producción exportado, no puede ganar. Después, como `dotenv.ts` nunca
 * pisa, el `.env` normal ya no puede colar sus valores.
 *
 * Y pasa la barrera: si algo se parece a producción, lanza, y vitest no corre
 * ni un test.
 */

const candidatos = ['.env.staging', '../../.env.staging'];
let cargado: string | null = null;
for (const c of candidatos) {
  try {
    const raw = readFileSync(resolve(process.cwd(), c), 'utf8');
    for (const linea of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
      if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    cargado = c;
    break;
  } catch {
    /* siguiente */
  }
}
if (!cargado) {
  throw new Error('No hay .env.staging (ni en apps/middleware ni en la raíz). Copia .env.staging.example y rellénalo con el Odoo de staging.');
}

const r = comprobarStaging(process.env);
if (!r.ok) {
  throw new Error(`La batería de staging NO arranca: esto no parece staging.\n  · ${r.motivos.join('\n  · ')}`);
}
