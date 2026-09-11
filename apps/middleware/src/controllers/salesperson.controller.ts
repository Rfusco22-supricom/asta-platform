import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getPartnerInvoicingSummary,
  getInvoicingTotalsByPartner,
} from '../services/invoicing.service.js';
import {
  assertSalespersonOwnsPartner,
  getPartnersBySalesperson,
} from '../services/partners.service.js';
import { auditContext, recordAudit } from '../services/audit.service.js';
import { getClientProfile } from '../services/profile.service.js';

/** Un rol sin permiso para el modulo de vendedores tambien deja rastro. */
function denegarPorRol(req: Request, res: Response): void {
  recordAudit({
    action: 'access.denied.role',
    ...auditContext(req),
    targetType: 'endpoint',
    targetId: req.path,
    metadata: { rol: req.identity?.role ?? null },
  });
  res.status(403).json({
    error: { code: 'ROLE_NOT_ALLOWED', message: 'Requiere rol de vendedor' },
  });
}

/**
 * Controlador del módulo de vendedores.
 *
 * Invariante de seguridad de todo el archivo: el `partnerId` que llega por la URL
 * es una *petición*, no una autorización. Antes de tocar Odoo con él hay que
 * probar que el cliente pertenece a la cartera de quien pregunta. La única
 * excepción es SUPERADMIN.
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
    const { identity } = req; // lo inyecta authJwt()

    // ── Autorización ────────────────────────────────────────────────────────
    let partner = null;
    if (identity.role !== 'SUPERADMIN') {
      if (identity.role !== 'VENDEDOR' || identity.odooUserId === null) {
        denegarPorRol(req, res);
        return;
      }
      // Lanza ForbiddenPartnerAccess (403) o PartnerNotFound (404).
      partner = await assertSalespersonOwnsPartner(identity.odooUserId, partnerId);
    }

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

    if (identity.role !== 'VENDEDOR' || identity.odooUserId === null) {
      denegarPorRol(req, res);
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
    const { identity } = req;

    if (identity.role !== 'SUPERADMIN') {
      if (identity.role !== 'VENDEDOR' || identity.odooUserId === null) {
        denegarPorRol(req, res);
        return;
      }
      await assertSalespersonOwnsPartner(identity.odooUserId, partnerId);
    }

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
