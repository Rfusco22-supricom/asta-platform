import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { publicInvoiceListQuerySchema } from '@asta/shared-types';
import {
  getPartnerInvoice,
  invoiceExists,
  listPartnerInvoices,
} from '../services/invoicing.service.js';
import { recordAudit } from '../services/audit.service.js';
import { auditContext } from '../middleware/auditContext.js';

/**
 * API pública del cliente (#32). Gate de seguridad: #36.
 *
 * Regla de todo este fichero: el cliente sale de `req.scopedPartnerId`, que fija
 * `scopeToOwnPartner` a partir de la API key. Nunca de `req.query`, `req.body` ni
 * `req.params`.
 */

/**
 * El partner del token.
 *
 * Si falta es un error de montaje —la ruta no pasó por `scopeToOwnPartner`—, no
 * algo que el cliente pueda provocar. Se lanza en vez de seguir con `undefined`:
 * un `partner_id child_of undefined` en Odoo no es un filtro vacío, es un filtro
 * que no filtra.
 */
function partnerDelToken(req: Request): number {
  const id = req.scopedPartnerId;
  if (!id) throw new Error('scopedPartnerId ausente: la ruta no pasó por scopeToOwnPartner()');
  return id;
}

const idFacturaSchema = z.object({ id: z.coerce.number().int().positive() });

/** Respuesta ÚNICA para "no existe" y "es de otro cliente". Ver `verFacturaHandler`. */
function facturaNoEncontrada(res: Response): void {
  res.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Factura no encontrada.' } });
}

/** `GET /api/v1/public/invoices` */
export async function listarFacturasHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = publicInvoiceListQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: z.prettifyError(query.error) },
      });
      return;
    }

    const { pagina, porPagina, desde, hasta, estadoPago } = query.data;
    const { facturas, total } = await listPartnerInvoices(partnerDelToken(req), {
      desde,
      hasta,
      estadoPago,
      limit: porPagina,
      offset: (pagina - 1) * porPagina,
    });

    res.json({ data: facturas, meta: { pagina, porPagina, total } });
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/v1/public/invoices/:id`
 *
 * Una factura de OTRO cliente responde exactamente igual que una que no existe:
 * mismo 404, mismo cuerpo. Un 403 le confirmaría al que prueba ids que ese id sí
 * existe y es de alguien — y con ids consecutivos, eso es enumerar la
 * facturación de la empresa.
 *
 * Lo que sí se distingue es el REGISTRO. Tras un 404 se comprueba si la factura
 * existe; si existe, es un intento de acceso cruzado y se audita (#36). Esa
 * comprobación corre en los dos casos, así que tampoco hay diferencia de tiempo
 * de respuesta que delate cuál fue.
 */
export async function verFacturaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = idFacturaSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: { code: 'INVALID_INVOICE_ID', message: 'id de factura inválido' } });
      return;
    }

    const partnerId = partnerDelToken(req);
    const factura = await getPartnerInvoice(partnerId, params.data.id);

    if (!factura) {
      if (await invoiceExists(params.data.id)) {
        recordAudit({
          action: 'access.denied.partner',
          ...auditContext(req),
          targetType: 'account.move',
          targetId: String(params.data.id),
          metadata: {
            via: 'api_key',
            apiKeyId: req.identity?.apiKeyId ?? null,
            partnerDelToken: partnerId,
            path: req.path,
          },
        });
      }
      facturaNoEncontrada(res);
      return;
    }

    res.json({ data: factura });
  } catch (error) {
    next(error);
  }
}

/** Endpoints declarados en el contrato pero todavía sin implementar. */
export function noImplementadoHandler(_req: Request, res: Response): void {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED' } });
}
