import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests de #25 pegan a Odoo real: descubrir fixtures y ejercitar
    // veinte casos contra una instancia remota no cabe en 5 segundos.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // En serie: son requests contra el ERP de produccion, no conviene
    // dispararlos en paralelo desde varios workers.
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
    // Explicito: los tests necesitan la autenticacion de desarrollo para poder
    // suplantar a cada vendedor. En produccion authDev.ts ni se deja importar.
    env: { DEV_AUTH_ENABLED: 'true', LOG_LEVEL: 'silent' },
  },
});
