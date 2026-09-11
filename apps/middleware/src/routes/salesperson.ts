import { Router } from 'express';
import {
  getClientInvoicing,
  getClientProfileHandler,
  getPortfolio,
} from '../controllers/salesperson.controller.js';
import { authDev, listDevSalespeople } from '../middleware/authDev.js';

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

/**
 * Lista de vendedores para la pantalla de login provisional.
 *
 * Va ANTES de authDev() porque es justo lo que se consulta para poder
 * autenticarse. Se sirve desde aquí y no desde Next consultando Odoo porque el
 * principio rector del sistema es que el middleware es el ÚNICO que habla con
 * el ERP: saltárselo "solo para una pantalla de desarrollo" es como se empiezan
 * a abrir esos agujeros.
 *
 * Desaparece con authDev.ts al cerrar #17.
 */
salespersonRouter.get('/_dev/vendedores', listDevSalespeople);

salespersonRouter.use(authDev());

salespersonRouter.get('/portfolio', getPortfolio);
salespersonRouter.get('/clients/:partnerId/invoicing', getClientInvoicing);
salespersonRouter.get('/clients/:partnerId/profile', getClientProfileHandler);
