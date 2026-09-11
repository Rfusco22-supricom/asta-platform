import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { odooEnv } from './config/odooEnv.js';
import { getUid, executeKw } from './odoo/client.js';
import { salespersonRouter } from './routes/salesperson.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { warnIfDevAuthEnabled } from './middleware/authDev.js';

/**
 * Servidor del middleware.
 *
 * De momento solo monta la superficie del panel de vendedores (Fase 3), que lee
 * exclusivamente de Odoo y no necesita MySQL. La API pública (Fase 4) se monta
 * cuando existan sus endpoints.
 */

const PORT = Number(process.env.PORT ?? 3001);
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN ?? 'http://localhost:3000';

export function createApp() {
  const app = express();

  // Detrás de un proxy, req.ip debe ser la IP real del cliente y no la del
  // balanceador. Importa porque de ahí salen los registros de auditoría.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));

  app.use(
    pinoHttp({
      level: process.env.LOG_LEVEL ?? 'info',
      // Sin esto, las cabeceras de autenticación acaban en texto plano en el log.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers.cookie',
          'req.headers["x-dev-odoo-user-id"]',
        ],
        remove: true,
      },
      // El health check dispara cada pocos segundos: ahogaría el log.
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  // CORS solo para el panel. La API pública se consume con API key desde
  // servidores, no desde navegadores, así que no lleva CORS.
  app.use(
    '/api/v1/salesperson',
    cors({ origin: WEB_APP_ORIGIN, credentials: true }),
    salespersonRouter,
  );

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    const t0 = performance.now();
    let odoo: { ok: boolean; ms: number; error?: string };

    try {
      await getUid();
      await executeKw('res.users', 'search_count', [[['id', '=', 1]]]);
      odoo = { ok: true, ms: Math.round(performance.now() - t0) };
    } catch (error) {
      odoo = {
        ok: false,
        ms: Math.round(performance.now() - t0),
        error: error instanceof Error ? error.message.slice(0, 120) : 'desconocido',
      };
    }

    // MySQL todavía no se comprueba: la Fase 3 no lo usa y la base no está
    // montada. Se añade al cerrar #12.
    res.status(odoo.ok ? 200 : 503).json({
      status: odoo.ok ? 'ok' : 'degraded',
      dependencias: {
        odoo: { ...odoo, url: odooEnv.ODOO_URL, db: odooEnv.ODOO_DB },
        mysql: { ok: null, nota: 'sin comprobar — pendiente del issue #12' },
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Solo arranca al ejecutarse directamente, no al importarse desde un test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  warnIfDevAuthEnabled();

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`middleware escuchando en http://localhost:${PORT}`);
    console.log(`  health    GET /health`);
    console.log(`  vendedor  GET /api/v1/salesperson/portfolio`);
    console.log(`  vendedor  GET /api/v1/salesperson/clients/:partnerId/invoicing`);
  });

  // Cierre ordenado: deja terminar los requests en vuelo antes de morir.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      console.log(`\n${signal} recibido, cerrando...`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
