/**
 * Soporte de `logDescargas.test.ts`: levanta la app con el log ACTIVO, pide una
 * descarga con el token que recibe por argumento y termina.
 *
 * Proceso aparte porque la suite corre con `LOG_LEVEL=silent` y el logger se
 * crea al importar: dentro de vitest no hay log que mirar.
 */
import { createApp } from '../../server.js';

const token = process.argv[2];
const app = createApp();
const server = app.listen(0, async () => {
  const dir = server.address();
  const port = typeof dir === 'object' && dir ? dir.port : 0;
  await fetch(`http://127.0.0.1:${port}/api/v1/descargas/facturas/${token}`);
  // pino escribe de forma asíncrona: margen para que salga la línea.
  setTimeout(() => {
    server.close();
    process.exit(0);
  }, 300);
});
