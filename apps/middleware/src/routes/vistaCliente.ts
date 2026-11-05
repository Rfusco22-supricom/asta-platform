import { Router, type Request } from 'express';
import { mesSchema } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { autorizar } from '../middleware/autorizar.js';
import { metricasDeCliente } from '../services/metricasCliente.service.js';
import { mesDe, porMarcar, resumenSellOut } from '../services/sellOut.service.js';
import { pedidoSugerido, pedidosDelCliente } from '../services/pedidoSugerido.service.js';
import { datosFlyer } from '../services/flyers.service.js';
import { calculadora } from '../services/calculadora.service.js';
import { comparativaZona } from '../services/comparativaZona.service.js';
import { dePantalla } from '../services/pantallas.js';
import { responderFacturas, responderFotoProducto, responderPdfFactura } from './respuestasCliente.js';

/**
 * `/admin/vista-cliente/:partnerId/…`: el panel de un cliente tal como lo ve
 * él, para que el administrador lo revise. Las MISMAS lecturas que `/account`
 * (mismos servicios, mismas respuestas), con el cliente en la ruta en vez de en
 * el token.
 *
 * Solo GET. Lo que el cliente puede HACER en su panel —marcar lo vendido, subir
 * su sell-out, enviar un pedido— no tiene equivalente aquí: el administrador
 * mira, no actúa en su nombre.
 */
export const vistaClienteRouter = Router({ mergeParams: true });

vistaClienteRouter.use(autorizar('admin.vista.cliente'));

function partnerDe(req: Request): number | null {
  const id = Number((req.params as { partnerId?: string }).partnerId);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

/** La tarifa que el sync copió a su cuenta, si tiene: la misma que usaría su token. */
async function tarifaDeSuCuenta(partnerId: number): Promise<number | null> {
  const u = await prisma.appUser.findFirst({ where: { odooPartnerId: partnerId }, select: { odooPricelistId: true } });
  return u?.odooPricelistId ?? null;
}

vistaClienteRouter.use((req, res, next) => {
  if (partnerDe(req) === null) {
    res.status(400).json({ error: { code: 'INVALID_PARTNER_ID', message: 'Cliente no válido.' } });
    return;
  }
  next();
});

vistaClienteRouter.get('/metricas', async (req, res, next) => {
  try {
    res.json({ data: await metricasDeCliente(partnerDe(req)!) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/zona', async (req, res, next) => {
  try {
    res.json({ data: await comparativaZona(partnerDe(req)!) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/sellout', async (req, res, next) => {
  try {
    res.json({ data: await resumenSellOut(partnerDe(req)!) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/sellout/marcar', async (req, res, next) => {
  try {
    const mes = req.query.mes === undefined ? mesDe(new Date()) : mesSchema.safeParse(req.query.mes).data;
    if (!mes) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'El mes va como AAAA-MM.' } });
      return;
    }
    res.json({ data: await porMarcar(partnerDe(req)!, mes) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/pedido-sugerido', async (req, res, next) => {
  try {
    const partnerId = partnerDe(req)!;
    res.json({ data: await pedidoSugerido(partnerId, await tarifaDeSuCuenta(partnerId), req.log) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/pedidos', async (req, res, next) => {
  try {
    res.json({ data: await pedidosDelCliente(partnerDe(req)!) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/facturas', async (req, res, next) => {
  try {
    await responderFacturas(partnerDe(req)!, req.query as Record<string, unknown>, res);
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/facturas/:id/pdf', async (req, res, next) => {
  try {
    await responderPdfFactura(partnerDe(req)!, req.params.id, res);
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/flyers', async (req, res, next) => {
  try {
    const partnerId = partnerDe(req)!;
    res.json({ data: await dePantalla(`cliente:${partnerId}:flyers`, () => datosFlyer(partnerId)) });
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/flyers/fotos/:templateId', async (req, res, next) => {
  try {
    await responderFotoProducto(req.params.templateId, res);
  } catch (error) {
    next(error);
  }
});

vistaClienteRouter.get('/calculadora', async (req, res, next) => {
  try {
    const partnerId = partnerDe(req)!;
    res.json({ data: await dePantalla(`cliente:${partnerId}:calculadora`, async () => calculadora(partnerId, await tarifaDeSuCuenta(partnerId), req.log)) });
  } catch (error) {
    next(error);
  }
});
