import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getPartnerInvoicingSummary,
  getInvoicingTotalsByPartner,
} from '../services/invoicing.service.js';
import { getPartnersBySalesperson } from '../services/partners.service.js';
import { getClientProfile } from '../services/profile.service.js';

/**
 * Controlador del módulo de vendedores.
 *
 * AQUÍ YA NO SE AUTORIZA NADA. El rol y la pertenencia del cliente los aplica
 * `autorizar(accion)` en la ruta, guiado por la matriz de `@asta/shared-types`.
 *
 * Sigue en pie el invariante, solo que lo garantiza otra capa: el `partnerId`
 * de la URL es una *petición*, no una autorización. Cuando la acción declara
 * ámbito `partner-propio`, el middleware deja en `req.partnerAutorizado` el
 * cliente ya verificado — si el controlador lo recibe, la comprobación pasó.
 */

const paramsSchema = z.object({
  partnerId: z.coerce.number().int().positive(),
});

const querySchema = z.object({
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  incluirNotasDeCredito: z.coerce.boolean().default(false),
  incluirSerieMensual: z.coerce.boolean().default(false),
});

/**
 * GET /api/v1/salesperson/clients/:partnerId/invoicing
 *
 * Devuelve cuánto ha facturado ese cliente, leído en vivo de account.move.
 */
export async function getClientInvoicing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: { code: 'INVALID_PARTNER_ID', message: 'partnerId inválido' } });
      return;
    }

    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: z.prettifyError(query.error) },
      });
      return;
    }

    const { partnerId } = params.data;
    // Ya verificado por `autorizar('cliente.ver')`. Es null solo para SUPERADMIN,
    // que se salta la comprobación de cartera porque no tiene una.
    const partner = req.partnerAutorizado ?? null;

    const resumen = await getPartnerInvoicingSummary(partnerId, query.data);

    res.json({
      data: {
        cliente: partner
          ? { id: partner.id, nombre: partner.nombre, tier: partner.tier }
          : { id: partnerId },
        facturacion: resumen,
      },
      meta: {
        fuente: 'odoo:account.move',
        criterio: query.data.incluirNotasDeCredito
          ? 'facturas contabilizadas netas de notas de crédito'
          : 'facturas contabilizadas, sin notas de crédito',
        consultadoEn: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/salesperson/portfolio
 *
 * Cartera del vendedor con el facturado de cada cliente, para la tabla principal
 * de su dashboard. Cuesta 2 RPC en total, no 2 por cliente.
 */
export async function getPortfolio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { identity } = req;

    // `autorizar('cartera.ver')` ya garantizó el rol VENDEDOR. El odooUserId
    // puede seguir siendo null si el usuario está mal sincronizado.
    if (identity.odooUserId === null) {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Tu usuario no está vinculado a un vendedor de Odoo. Avisa al administrador.',
        },
      });
      return;
    }

    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: z.prettifyError(query.error) },
      });
      return;
    }

    const clientes = await getPartnersBySalesperson(identity.odooUserId);
    const totales = await getInvoicingTotalsByPartner(
      clientes.map((c) => c.id),
      query.data,
    );

    const filas = clientes.map((cliente) => {
      const t = totales.get(cliente.id) ?? { total: 0, porCobrar: 0, facturas: 0 };
      return {
        id: cliente.id,
        nombre: cliente.nombre,
        email: cliente.email,
        telefono: cliente.telefono,
        tier: cliente.tier,
        tierDerivado: cliente.tierDerivado,
        totalFacturado: t.total,
        porCobrar: t.porCobrar,
        numeroFacturas: t.facturas,
        esCliente: cliente.esCliente,
      };
    });

    filas.sort((a, b) => b.totalFacturado - a.totalFacturado);

    res.json({
      data: filas,
      meta: {
        clientes: filas.length,
        totalCartera: Math.round(filas.reduce((s, f) => s + f.totalFacturado, 0) * 100) / 100,
        porCobrarCartera: Math.round(filas.reduce((s, f) => s + f.porCobrar, 0) * 100) / 100,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/salesperson/clients/:partnerId/profile
 *
 * Recencia y top de productos. Pasa por la MISMA puerta de autorización que la
 * facturación: cualquier endpoint nuevo que no llame a
 * `assertSalespersonOwnsPartner` es una fuga esperando a ocurrir.
 */
export async function getClientProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: { code: 'INVALID_PARTNER_ID', message: 'partnerId inválido' } });
      return;
    }

    const { partnerId } = params.data;

    const perfil = await getClientProfile(partnerId);

    res.json({
      data: perfil,
      meta: {
        fuente: 'odoo:account.move.line',
        criterio: 'subtotales sin impuestos de facturas contabilizadas',
        consultadoEn: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}
