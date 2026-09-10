import { Router } from 'express';
import { authApiKey, requireScope, scopeToOwnPartner } from '../middleware/apiKeyAuth.js';
import { getClientInvoicing, getPortfolio } from '../controllers/salesperson.controller.js';

/**
 * Dos superficies distintas bajo /api/v1:
 *
 *   /api/v1/salesperson/*   -> panel web, autenticado por JWT de Supabase
 *   /api/v1/public/*        -> integraciones de clientes, autenticadas por API key
 *
 * Se mantienen separadas a propósito. Mezclar ambos esquemas de autenticación en
 * la misma ruta es la vía más corta a un endpoint que valida el token pero se
 * olvida de aplicar el scoping por cliente.
 */
export const v1 = Router();

// ── Panel del vendedor (JWT) ─────────────────────────────────────────────────
// authJwt() se aplica a nivel de app antes de montar este router.
v1.get('/salesperson/portfolio', getPortfolio);
v1.get('/salesperson/clients/:partnerId/invoicing', getClientInvoicing);

// ── API pública del cliente (API key) ────────────────────────────────────────
const publicApi = Router();

publicApi.use(authApiKey());
publicApi.use(scopeToOwnPartner());

publicApi.get('/inventory', requireScope('INVENTORY_READ'), (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED' } });
});

publicApi.get('/pricing', requireScope('PRICING_READ'), (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED' } });
});

publicApi.get('/invoices', requireScope('INVOICES_READ'), (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED' } });
});

publicApi.get('/recommender/compatible', requireScope('RECOMMENDER_READ'), (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED' } });
});

v1.use('/public', publicApi);
