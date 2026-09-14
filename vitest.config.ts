import { defineConfig } from 'vitest/config';

/**
 * Tests de los scripts de la raíz.
 *
 * El middleware tiene su propia configuración en `apps/middleware`, con tiempos
 * largos porque sus tests pegan contra Odoo de verdad. Los de aquí son al revés:
 * lógica pura, sin red ni base de datos, y por eso no comparten configuración.
 *
 * Existe porque hasta ahora los scripts no tenían dónde probarse. La comparación
 * de copias de configuración de Odoo (#48) es justo el tipo de código que falla
 * en silencio: si deja de detectar un cambio, el respaldo se sigue guardando
 * igual de bien y nadie se entera.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
  },
});
