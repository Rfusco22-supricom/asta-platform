import { Router } from 'express';
import { authApiKey, requireScope, scopeToOwnPartner } from '../middleware/apiKeyAuth.js';
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
 * El orden importa y no se toca: primero quién eres (`authApiKey`), luego a qué
 * cliente quedas atado (`scopeToOwnPartner`), y solo entonces qué puedes hacer
 * (`requireScope`). Un scope no significa nada sin saber sobre qué cliente se
 * ejerce.
 */
export const publicRouter = Router();

publicRouter.use(authApiKey());
publicRouter.use(scopeToOwnPartner());

publicRouter.get('/invoices', requireScope('INVOICES_READ'), listarFacturasHandler);
publicRouter.get('/invoices/:id', requireScope('INVOICES_READ'), verFacturaHandler);

publicRouter.get('/inventory', requireScope('INVENTORY_READ'), noImplementadoHandler);
publicRouter.get('/pricing', requireScope('PRICING_READ'), noImplementadoHandler);
publicRouter.get('/recommender/compatible', requireScope('RECOMMENDER_READ'), noImplementadoHandler);
