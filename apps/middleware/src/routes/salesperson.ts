import { Router } from 'express';
import {
  getClientInvoicing,
  getClientProfileHandler,
  getPortfolio,
} from '../controllers/salesperson.controller.js';
import { authJwt } from '../middleware/authJwt.js';

/**
 * Superficie del panel de vendedores (Fase 3).
 *
 * Lee exclusivamente de Odoo: ni un SELECT contra MySQL salvo el de la propia
 * autenticación.
 *
 * Autenticación REAL desde el cierre de #17. `authDev.ts` —el bypass que
 * permitió construir esta fase antes de que existiera la base de datos— está
 * borrado. No se dejó "por si acaso": un bypass de autenticación que sobrevive
 * es exactamente el que acaba activo en producción por accidente.
 */
export const salespersonRouter = Router();

salespersonRouter.use(authJwt());

salespersonRouter.get('/portfolio', getPortfolio);
salespersonRouter.get('/clients/:partnerId/invoicing', getClientInvoicing);
salespersonRouter.get('/clients/:partnerId/profile', getClientProfileHandler);
