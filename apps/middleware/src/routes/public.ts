import { Router } from 'express';
import { authApiKey, requireScope, scopeToOwnPartner } from '../middleware/apiKeyAuth.js';
import { crearLimitadoresPublicos } from '../middleware/rateLimitPublico.js';
import {
  listarFacturasHandler,
  noImplementadoHandler,
  verFacturaHandler,
} from '../controllers/public.controller.js';

/**
 * API pública del cliente, autenticada por API key (Track B).
 *
 * Se monta en `/api/v1/public` SIN el CORS del panel: la consumen integraciones
 * servidor a servidor, no un navegador.
 *
 * Sustituye a `routes/v1.ts`, que definía este mismo router pero no lo importaba
 * nadie: la API pública nunca llegó a estar montada, y `/api/v1/public/*`
 * respondía 404. No se notó porque `authApiKey` y `scopeToOwnPartner` se
 * probaban como funciones sueltas, y funcionaban.
 *
 * El orden importa y no se toca:
 *
 *   1. `preAuth`             frena a quien acumula keys inválidas, antes de que
 *                            cada intento pague la verificación contra la base
 *   2. `authApiKey`          quién eres
 *   3. `porKey`              cuánto puedes pedir. Después de autenticar, porque
 *                            necesita saber qué key es; y antes que todo lo demás,
 *                            para que también cuenten los 400 y 403 — probar
 *                            `partner_id` o ids de factura con una key válida no
 *                            puede salir gratis
 *   4. `scopeToOwnPartner`   a qué cliente quedas atado
 *   5. `requireScope`        qué puedes hacer. Un scope no significa nada sin
 *                            saber sobre qué cliente se ejerce
 *
 * Es una fábrica para que cada app tenga sus propios contadores de rate limit.
 * Ver `crearLimitadoresPublicos`.
 */
export function crearPublicRouter(): Router {
  const router = Router();
  const limitar = crearLimitadoresPublicos();

  router.use(limitar.preAuth);
  router.use(authApiKey());
  router.use(limitar.porKey);
  router.use(scopeToOwnPartner());

  router.get('/invoices', requireScope('INVOICES_READ'), listarFacturasHandler);
  router.get('/invoices/:id', requireScope('INVOICES_READ'), verFacturaHandler);

  router.get('/inventory', requireScope('INVENTORY_READ'), noImplementadoHandler);
  router.get('/pricing', requireScope('PRICING_READ'), noImplementadoHandler);
  router.get('/recommender/compatible', requireScope('RECOMMENDER_READ'), noImplementadoHandler);

  return router;
}
