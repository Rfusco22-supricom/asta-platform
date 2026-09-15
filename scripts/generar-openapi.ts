/**
 * Escribe `docs/api/openapi.json`, la especificación de la API pública (#35).
 *
 *   pnpm openapi
 *
 * El servidor la genera al vuelo en `/api/v1/docs/openapi.json`, así que este
 * archivo no lo necesita nadie para funcionar. Existe para la REVISIÓN: un PR que
 * cambia el contrato de la API cambia este archivo, y el cambio se ve en el diff.
 * Es la forma práctica de aplicar docs/07-VERSIONADO-API.md: un campo que
 * desaparece del JSON salta a la vista.
 *
 * `docsApi.test.ts` falla si el archivo no está al día.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirOpenApi } from '../apps/middleware/src/openapi/especificacion.js';

export const RUTA_OPENAPI = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/api/openapi.json');

export function openApiVersionada(): string {
  return `${JSON.stringify(construirOpenApi(), null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(RUTA_OPENAPI), { recursive: true });
  writeFileSync(RUTA_OPENAPI, openApiVersionada());
  console.log(`escrito ${RUTA_OPENAPI}`);
}
