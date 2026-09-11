import { Router } from 'express';
import { getClientInvoicing, getPortfolio } from '../controllers/salesperson.controller.js';
import { authDev } from '../middleware/authDev.js';

/**
 * Superficie del panel de vendedores (Fase 3).
 *
 * Lee exclusivamente de Odoo: ni un SELECT contra MySQL. Por eso funciona hoy,
 * antes de que exista la base.
 *
 * La autenticación es `authDev()` PROVISIONALMENTE. Cuando esté #17, se cambia
 * por `authJwt()` aquí —una línea— y se borra `middleware/authDev.ts`.
 */
export const salespersonRouter = Router();

salespersonRouter.use(authDev());

salespersonRouter.get('/portfolio', getPortfolio);
salespersonRouter.get('/clients/:partnerId/invoicing', getClientInvoicing);
