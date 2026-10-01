import { defineConfig } from 'vitest/config';

/**
 * Solo la lógica que no depende de React Native: el cliente de la API y el
 * temporizador. Las pantallas se prueban en la tablet, no aquí: montar el
 * runtime de RN en vitest cuesta más de lo que encuentra.
 */
export default defineConfig({
  test: { include: ['src/__tests__/**/*.test.ts'], environment: 'node' },
});
