import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import { odooEnv } from './config/odooEnv.js';
import { getUid, executeKw } from './odoo/client.js';
import { metricasOdoo } from './odoo/metrics.js';
import { salespersonRouter } from './routes/salesperson.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { crearPublicRouter } from './routes/public.js';
import { crearDescargasRouter } from './routes/descargas.js';
import { ocultarTokenDeUrl } from './services/enlacesFirmados.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { installDbAuditSink, installLogAuditSink } from './services/audit.service.js';
import { prisma } from './config/prisma.js';
import { logger } from './utils/logger.js';
import { exigirEntornoValido } from './config/validarEntorno.js';
import { env } from './config/env.js';

/**
 * Servidor del middleware.
 *
 * Monta la superficie del panel de vendedores (Fase 3), la de autenticación y la
 * API pública del cliente por API key (Fase 4, #32 · gate #36).
 */

const PORT = Number(process.env.PORT ?? 3001);


export function createApp() {
  installLogAuditSink();
  installDbAuditSink();

  const app = express();

  /*
   * Frontera de confianza para IP y user-agent (issue #52).
   *
   * Sin esto, `req.ip` es la del servidor de Next y no la de la persona, porque
   * el navegador nunca llama aquí directamente. Con esto, a un par de confianza
   * se le cree su `X-Forwarded-For`; a cualquier otro, no. Por defecto solo
   * loopback, que es la topología de desarrollo — en EasyPanel habrá que poner
   * la red del contenedor en TRUSTED_PROXIES.
   */
  app.set('trust proxy', env().TRUSTED_PROXIES);

  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      // El nivel y la redacción de cabeceras viven en utils/logger.ts, que es
      // el MISMO logger que usa el cliente de Odoo. Compartirlo es lo que
      // permite cruzar una petición lenta con el RPC que la hizo lenta.
      logger,
      // El health check dispara cada pocos segundos: ahogaría el log.
      autoLogging: { ignore: (req) => req.url === '/health' },
      // En `/api/v1/descargas` la URL lleva el enlace firmado, que durante
      // 5 minutos ES la credencial (#32). No puede quedar escrita en el log.
      serializers: {
        req: (req: { url?: string }) => {
          if (req.url) req.url = ocultarTokenDeUrl(req.url);
          return req;
        },
      },
    }),
  );

  // CORS solo para el panel. La API pública se consume con API key desde
  // servidores, no desde navegadores, así que no lleva CORS.
  // Del entorno VALIDADO, no de `process.env` directo: ahí es donde se le quita
  // la barra final, y sin ese paso un `https://panel/` copiado del panel de
  // despliegue no casa nunca con el `Origin` que manda el navegador.
  const corsPanel = cors({ origin: env().WEB_APP_ORIGIN, credentials: true });

  app.use('/api/v1/auth', corsPanel, authRouter);
  app.use('/api/v1/salesperson', corsPanel, salespersonRouter);
  app.use('/api/v1/admin', corsPanel, adminRouter);
  app.use('/api/v1/public', crearPublicRouter());
  app.use('/api/v1/descargas', crearDescargasRouter());

  // ── Health ────────────────────────────────────────────────────────────────
  /**
   * Estado de las dos dependencias duras (issue #11).
   *
   * Lo mira quien está de guardia, normalmente de madrugada y con prisa, así
   * que tiene que decir la verdad y decirla entera:
   *
   *   · Se comprueban Odoo Y MySQL. Odoo trae la facturación; MySQL trae las
   *     sesiones, las notas y el sync. Con MySQL caída no se puede ni entrar
   *     al panel, así que un 200 mirando solo a Odoo sería una mentira.
   *
   *   · Las dos se piden EN PARALELO. Encadenarlas sumaría las latencias y,
   *     con Odoo colgado, el propio health se quedaría colgado con él.
   *
   *   · Cada una lleva su propio timeout. Sin él, "caído" y "lentísimo" se
   *     parecen demasiado: la petición se queda esperando y el monitor no
   *     recibe respuesta en vez de recibir un 503.
   *
   *   · El status agregado es el PEOR de los dos. Medio sistema en pie no es
   *     un sistema en pie.
   *
   * No lleva autenticación a propósito: un health que exige token no sirve
   * para lo que existe. Por eso tampoco revela nada explotable — ni versiones,
   * ni cadenas de conexión, ni credenciales.
   */
  const TIMEOUT_SONDA_MS = 5000;

  interface Sonda {
    ok: boolean;
    ms: number;
    error?: string;
  }

  /** Ejecuta una comprobación acotada en el tiempo y nunca lanza. */
  async function sondear(fn: () => Promise<unknown>): Promise<Sonda> {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);

    try {
      await Promise.race([
        fn(),
        new Promise((_, rechazar) =>
          setTimeout(
            () => rechazar(new Error(`sin respuesta en ${TIMEOUT_SONDA_MS} ms`)),
            TIMEOUT_SONDA_MS,
          ),
        ),
      ]);
      return { ok: true, ms: ms() };
    } catch (error) {
      return {
        ok: false,
        ms: ms(),
        // Recortado: el mensaje de un driver puede traer la cadena de conexión
        // entera, y esto se sirve sin autenticar.
        error: error instanceof Error ? error.message.slice(0, 120) : 'desconocido',
      };
    }
  }

  app.get('/health', async (_req, res) => {
    const [odoo, mysql] = await Promise.all([
      sondear(async () => {
        await getUid();
        // `medir: false`: esta llamada NO entra en la ventana de latencia. Es
        // una sonda trivial y, consultada cada pocos segundos por un monitor,
        // desplazaría al tráfico real y dejaría el p95 en una cifra preciosa
        // que no describe nada.
        await executeKw('res.users', 'search_count', [[['id', '=', 1]]], {}, { medir: false });
      }),
      /*
       * Una tabla REAL, no `SELECT 1` (issue #77).
       *
       * Antes era `SELECT 1`, con el razonamiento de comprobar la conexión sin
       * atar la salud a que el esquema estuviera migrado. Sonaba bien y tenía un
       * agujero: `SELECT 1` no toca ninguna tabla, así que tampoco detecta que
       * al usuario le falten permisos.
       *
       * Eso pasó en el primer despliegue. El health decía
       *
       *     "mysql": { "ok": true, "ms": 9 }
       *
       * mientras cada consulta de verdad moría con «User was denied access on
       * the database». Conexión viva, base inservible, semáforo en verde — que
       * es exactamente lo que un health check existe para evitar: quien está de
       * guardia mira el verde y descarta la base como causa.
       *
       * `app_users` es la tabla adecuada: la aplicación no sirve para nada sin
       * ella, así que si no se puede leer, la aplicación está caída aunque el
       * proceso siga en pie.
       *
       * Que esté VACÍA no es un fallo. `LIMIT 1` sobre cero filas devuelve cero
       * filas sin error, y eso es lo correcto: aquí se comprueba el acceso, no
       * el contenido.
       */
      sondear(() => prisma.$queryRaw`SELECT 1 FROM app_users LIMIT 1`),
    ]);

    const sano = odoo.ok && mysql.ok;

    res.status(sano ? 200 : 503).json({
      status: sano ? 'ok' : 'degraded',
      dependencias: {
        odoo: {
          ...odoo,
          url: odooEnv.ODOO_URL,
          db: odooEnv.ODOO_DB,
          /*
           * Latencia del tráfico REAL, no de la sonda de arriba (issue #46).
           *
           * La sonda mide una llamada trivial: dice si Odoo responde, no si
           * responde a tiempo bajo carga. El p95 sale de las últimas llamadas
           * que hizo el panel de verdad, que es lo que nota el vendedor.
           *
           * Se sirve aquí, sin autenticar como el resto de /health, porque son
           * números agregados: no revelan qué se consultó ni de quién.
           */
          latencia: metricasOdoo(),
        },
        mysql,
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
  // Lo PRIMERO, antes de abrir el puerto (issue #9). Un API_KEY_PEPPER ausente
  // no debe descubrirse la primera vez que alguien usa una API key: el servidor
  // habría arrancado, parecería sano y fallaría más tarde, que es justo el peor
  // momento. Aquí se cae en el segundo 0 diciendo qué variable falta.
  exigirEntornoValido();

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`middleware escuchando en http://localhost:${PORT}`);
    console.log(`  health    GET  /health`);
    console.log(`  sesión    POST /api/v1/auth/login · /refresh · /logout`);
    console.log(`  vendedor  GET /api/v1/salesperson/portfolio`);
    console.log(`  vendedor  GET /api/v1/salesperson/clients/:partnerId/invoicing`);
    console.log(`  cliente   GET /api/v1/public/invoices · /invoices/:id   (API key)`);
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
