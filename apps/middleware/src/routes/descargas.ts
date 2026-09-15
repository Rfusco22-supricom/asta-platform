import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { descargarPdfFacturaHandler } from '../controllers/descargas.controller.js';

/**
 * Descargas autorizadas por enlace firmado (#32). Sin API key y sin CORS.
 *
 * Fuera de `/api/v1/public` a propósito: aquel router exige API key en todas
 * sus rutas, y la gracia del enlace es que no la necesita.
 *
 * Límite por IP: cada descarga cuesta hasta 4 RPC a Odoo y lee el PDF entero en
 * memoria. Adivinar un token no es viable —HMAC-SHA256—, pero repetir uno válido
 * mil veces sí, y eso lo paga el ERP.
 */
export function crearDescargasRouter(): Router {
  const router = Router();

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: 'draft-6',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Demasiadas descargas. Espera un minuto.' } },
    }),
  );

  router.get('/facturas/:token', descargarPdfFacturaHandler);

  return router;
}
