import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { crearLimitadoresPublicos } from '../middleware/rateLimitPublico.js';
import { registroPeticiones } from '../middleware/registroPeticiones.js';
import { verificarTokenKiosco, type KioscoAutenticado } from '../services/kioscos.service.js';
import { buscarImpresorasHandler, clicRecomendadorHandler, compatiblesHandler } from '../controllers/public.controller.js';

/**
 * Las rutas de las tablets del kiosco (#40, #120): el recomendador y nada más.
 *
 * Se autentican con el token de la tablet (`kiosk_devices`), no con una API key
 * de cliente. Son los mismos handlers que `/api/v1/public/recommender/...`; lo
 * que cambia es quién pide —una tablet, no un usuario— y de qué almacén salen
 * las existencias: el de la tienda, no el de un cliente.
 *
 * El token viaja en `X-API-Key` igual que una key: así la app no tiene más que
 * una credencial que configurar. Y la versión de la app, en `X-App-Version`,
 * para saber desde el panel qué tablet se quedó atrás.
 *
 * Mismo orden que la API pública: bitácora, freno a quien acumula 401, quién
 * eres y cuánto puedes pedir.
 */

/** Una tablet hace una búsqueda cada pocos segundos como mucho. */
const PETICIONES_POR_MINUTO = 120;

function authKiosco() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.get('x-api-key') ?? req.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) {
        res.status(401).json({ error: { code: 'MISSING_API_KEY', message: 'Falta el token de la tablet en X-API-Key.' } });
        return;
      }
      const kiosco = await verificarTokenKiosco(token, req.get('x-app-version') ?? undefined);
      if (!kiosco) {
        req.log?.warn({ ip: req.ip }, 'token de kiosco rechazado');
        res.status(401).json({ error: { code: 'INVALID_API_KEY', message: 'Token de tablet inválido o desactivado.' } });
        return;
      }
      res.locals.kiosco = kiosco;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function crearKioskRouter(): Router {
  const router = Router();
  const { preAuth } = crearLimitadoresPublicos();

  router.use(registroPeticiones());
  router.use(preAuth);
  router.use(authKiosco());
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: PETICIONES_POR_MINUTO,
      keyGenerator: (_req, res) => (res.locals.kiosco as KioscoAutenticado).deviceId,
      standardHeaders: 'draft-6',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Esta tablet superó su límite de peticiones por minuto.' } },
    }),
  );

  router.get('/recommender/printers', buscarImpresorasHandler);
  router.get('/recommender/printers/:printerId/compatible', compatiblesHandler);
  router.post('/recommender/busquedas/:busquedaId/clic', clicRecomendadorHandler);
  // Señal de vida (#46): la app la manda cada pocos minutos mientras está
  // abierta. Basta con pasar por `authKiosco`, que apunta `last_seen_at`. Sin
  // esto, una tablet encendida pero sin clientes parecería apagada: la alerta
  // «kiosco mudo» saltaría cada vez que la tienda tiene una hora floja.
  router.get('/latido', (_req, res) => {
    res.json({ data: { ok: true } });
  });

  return router;
}
