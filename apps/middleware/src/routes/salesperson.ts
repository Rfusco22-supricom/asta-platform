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
import { hermanosDe } from '../services/hermanos.service.js';
import { reporte } from '../services/reportes.service.js';
import { rangoDeLaPeticion } from '../services/rango.js';
import { z } from 'zod';
import { nuevaCompatibilidadSchema } from '@asta/shared-types';
import { anadirCompatibilidad, propuestasDe } from '../services/recomendador/revisionImpresoras.service.js';
import { recordAudit } from '../services/audit.service.js';
import { auditContext } from '../middleware/auditContext.js';

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

/**
 * Otros registros del MISMO cliente (#50).
 *
 * Va con `cliente.perfil.ver` —ámbito `partner-propio`— así que `autorizar` ya
 * comprobó que el cliente que se mira es de quien pregunta. Lo que se revela de
 * los hermanos es un total, nunca sus facturas: ver la nota del servicio.
 */
salespersonRouter.get(
  '/clients/:partnerId/duplicados',
  autorizar('cliente.perfil.ver'),
  async (req, res, next) => {
    try {
      res.json({ data: await hermanosDe(Number(req.params.partnerId)) });
    } catch (error) {
      next(error);
    }
  },
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

/**
 * Reportes de la PROPIA cartera.
 *
 * El alcance no es un parámetro: sale del `odooUserId` del token firmado, igual
 * que en `/asta`. Un vendedor no puede pedir el reporte de otro porque no hay
 * forma de nombrarlo.
 */
salespersonRouter.get('/reportes', autorizar('reportes.propios.ver'), async (req, res, next) => {
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

    const rango = rangoDeLaPeticion(req.query as Record<string, unknown>);
    res.json(await reporte({ ...rango, soloDelVendedor: odooUserId }));
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilidades (#56)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proponer «a esta impresora le sirve este cartucho».
 *
 * Nace PROPUESTA, siempre: el vendedor conoce a sus clientes y sus equipos, pero
 * lo que llega al kiosco lo valida un administrador. Esta ruta no recibe ni
 * sabe pasar otra cosa. La del administrador es otra, con otra acción.
 */
salespersonRouter.post('/compatibilidades', autorizar('compatibilidades.proponer'), async (req, res, next) => {
  try {
    const cuerpo = nuevaCompatibilidadSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await anadirCompatibilidad(cuerpo.data, { autorId: req.identity.appUserId, validar: false });
    if (r.creada) {
      recordAudit({
        action: 'compatibilidad.anadida',
        ...auditContext(req),
        targetType: 'cartridge_printer_models',
        targetId: `${r.cartridgeId}:${r.printerModelId}`,
        metadata: { ...cuerpo.data, estado: r.estado, impresoraNueva: r.impresoraNueva, cartuchoNuevo: r.cartuchoNuevo },
      });
    }
    res.status(r.creada ? 201 : 200).json({ data: r });
  } catch (error) {
    next(error);
  }
});

/** Lo que ha propuesto quien pregunta, con su estado. Nunca lo de otros. */
salespersonRouter.get('/compatibilidades/propias', autorizar('compatibilidades.proponer'), async (req, res, next) => {
  try {
    res.json({ data: await propuestasDe(req.identity.appUserId) });
  } catch (error) {
    next(error);
  }
});
