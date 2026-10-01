import { defineConfig } from 'vitest/config';

/**
 * La batería de staging (#13): `pnpm test:staging`.
 *
 * Aparte de la normal, a propósito. Corre contra una COPIA de Odoo y escribe en
 * ella (crea pedidos con el escritor real de #33), así que no puede correr en la
 * batería de siempre, que lee del Odoo de producción.
 *
 * Los ficheros son `*.staging.ts`, no `*.test.ts`: así la configuración normal
 * no los recoge nunca, ni por error.
 *
 * `preparar.ts` carga `.env.staging` y pasa la barrera de `entornoStaging.ts`
 * ANTES de que ningún test importe nada. Si la configuración se parece a
 * producción, no corre ni un test.
 */
export default defineConfig({
  test: {
    include: ['src/__tests__/staging/**/*.staging.ts'],
    setupFiles: ['src/__tests__/staging/preparar.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    env: { LOG_LEVEL: 'silent' },
  },
});
