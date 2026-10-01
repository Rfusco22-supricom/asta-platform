import pino from 'pino';

/**
 * Logger compartido del middleware.
 *
 * Existe para que las peticiones HTTP y las llamadas a Odoo salgan por el mismo
 * sitio y con las mismas reglas de redacción. Antes `pino-http` se configuraba
 * suelto en `server.ts` y el cliente XML-RPC no registraba nada, así que las dos
 * mitades de una petición lenta no se podían cruzar.
 *
 * ── Lo que nunca puede salir por aquí ────────────────────────────────────────
 *
 * `redact` quita las cabeceras de autenticación. No es una precaución teórica:
 * `authorization` lleva el JWT de sesión y `x-api-key` la clave del cliente, y
 * un log es un fichero que se copia, se comparte en un ticket y se sube a un
 * servicio de terceros sin pensarlo.
 *
 * Y las de la RESPUESTA también: `pino-http` registra `res.headers`, y el login
 * y `/refresh` responden con `set-cookie: asta_rt=<token>`, el token de refresco
 * de 30 días. Hasta el 2026-10-01 solo se tapaban las de la petición, y cada
 * login dejaba en el log un token con el que entrar como esa persona durante un
 * mes. Lo vigila `logSesion.test.ts`.
 *
 * El cliente de Odoo, además, NO registra los argumentos de las llamadas: el
 * tercer parámetro de `execute_kw` es la API key del usuario de servicio, y los
 * dominios llevan datos de clientes reales.
 */

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'req.headers["x-dev-odoo-user-id"]',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
});

/** Logger de las llamadas al ERP. `rpc: true` para poder filtrarlas. */
export const odooLogger = logger.child({ rpc: true });
