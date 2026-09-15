import { Router } from 'express';
import {
  borrarNotaHandler,
  crearNotaHandler,
  getClientInvoicing,
  getClientProfileHandler,
  getPortfolio,
} from '../controllers/salesperson.controller.js';
import { authJwt } from '../middleware/authJwt.js';
import { autorizar } from '../middleware/autorizar.js';
import { oportunidadesAsta } from '../services/asta.service.js';

/**
 * Panel de vendedores (Fase 3).
 *
 * Cada ruta DECLARA su acción. El rol y la pertenencia del cliente los resuelve
 * `autorizar()` leyendo la matriz de permisos; los controladores no deciden
 * nada sobre autorización.
 *
 * Añadir un endpoint con `:partnerId` y declarar una acción de ámbito
 * `partner-propio` basta para que quede protegido. Antes había que acordarse de
 * dos cosas por separado, y olvidar la segunda no rompía nada visible.
 */
export const salespersonRouter = Router();

salespersonRouter.use(authJwt());

salespersonRouter.get('/portfolio', autorizar('cartera.ver'), getPortfolio);

salespersonRouter.get(
  '/clients/:partnerId/invoicing',
  autorizar('cliente.ver'),
  getClientInvoicing,
);

salespersonRouter.get(
  '/clients/:partnerId/profile',
  autorizar('cliente.perfil.ver'),
  getClientProfileHandler,
);

salespersonRouter.post(
  '/clients/:partnerId/notes',
  autorizar('cliente.notas.escribir'),
  crearNotaHandler,
);

// El :partnerId va en la ruta aunque la nota se identifique por su propio id:
// es lo que permite que `autorizar` compruebe que el cliente es de quien pide.
// Sin él, cualquiera con el id de una nota podria borrarla.
salespersonRouter.delete(
  '/clients/:partnerId/notes/:notaId',
  autorizar('cliente.notas.escribir'),
  borrarNotaHandler,
);

/**
 * Oportunidades de ASTA en la PROPIA cartera.
 *
 * El alcance no es un parámetro: sale de `odooUserId` del token firmado. Un
 * vendedor sin `res.users` asociado —dato mal sincronizado— recibe 403 en vez de
 * una consulta sin filtro, que en Odoo devolvería la empresa entera.
 */
salespersonRouter.get('/asta', autorizar('asta.propias.ver'), async (req, res, next) => {
  try {
    const odooUserId = req.identity.odooUserId;
    if (odooUserId === null) {
      res.status(403).json({
        error: {
          code: 'ROLE_NOT_ALLOWED',
          message: 'Tu usuario no tiene cartera asociada en Odoo.',
        },
      });
      return;
    }

    const r = await oportunidadesAsta({ soloDelVendedor: odooUserId });
    res.json({
      data: r.oportunidades,
      meta: { ...r.totales, generadoEn: r.generadoEn, duracionMs: r.duracionMs },
    });
  } catch (error) {
    next(error);
  }
});
