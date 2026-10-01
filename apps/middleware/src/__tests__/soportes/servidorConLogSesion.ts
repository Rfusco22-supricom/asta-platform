/**
 * Soporte de `logSesion.test.ts`: levanta la app con el log ACTIVO, cierra una
 * sesión con la cookie que recibe por argumento y termina.
 *
 * `logout` sirve porque no exige estar autenticado y siempre responde con un
 * `set-cookie` (la cookie vaciada): es la misma cabecera que lleva el token de
 * refresco en el login y en `/refresh`, sin necesitar un usuario en la base.
 *
 * Proceso aparte por lo mismo que `servidorConLog.ts`: la suite corre con
 * `LOG_LEVEL=silent` y el logger se crea al importar.
 */
import { createApp } from '../../server.js';

const token = process.argv[2];
const app = createApp();
const server = app.listen(0, async () => {
  const dir = server.address();
  const port = typeof dir === 'object' && dir ? dir.port : 0;
  await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie: `asta_rt=${token}` },
  });
  // pino escribe de forma asíncrona: margen para que salga la línea.
  setTimeout(() => {
    server.close();
    process.exit(0);
  }, 300);
});
