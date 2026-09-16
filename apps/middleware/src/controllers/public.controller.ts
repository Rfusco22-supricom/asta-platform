import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  compatibleQuerySchema,
  inventoryQuerySchema,
  printerIdParamSchema,
  printerSearchQuerySchema,
  publicInvoiceListQuerySchema,
} from '@asta/shared-types';
import { buscarImpresoras, compatiblesDe } from '../services/recomendador/recomendador.service.js';
import {
  getPartnerInvoice,
  invoiceExists,
  listPartnerInvoices,
} from '../services/invoicing.service.js';
import {
  almacenDelCliente,
  InventarioNoDisponible,
  listarInventario,
} from '../services/inventory.service.js';
import { buscarPdfDeFactura, PdfNoDisponible } from '../services/invoicePdf.service.js';
import { firmarEnlace } from '../services/enlacesFirmados.js';
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
    const factura = await facturaDelToken(req, res);
    if (!factura) return;
    res.json({ data: factura });
  } catch (error) {
    next(error);
  }
}

/**
 * La factura pedida en `:id`, si es del cliente del token. Si no, responde ella
 * misma —400 o el 404 único— y devuelve `null`.
 *
 * La comparten el detalle y el enlace al PDF (#32): el PDF es otra forma de ver
 * la misma factura, y no puede tener otra comprobación de propiedad distinta.
 * Dos copias de esta lógica son dos sitios donde una puede quedarse atrás.
 */
async function facturaDelToken(req: Request, res: Response) {
  const params = idFacturaSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: { code: 'INVALID_INVOICE_ID', message: 'id de factura inválido' } });
    return null;
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
    return null;
  }

  return factura;
}

/**
 * `GET /api/v1/public/invoices/:id/pdf` (#32)
 *
 * No devuelve el PDF: devuelve un ENLACE firmado que caduca en 5 minutos. La
 * descarga no pide API key —puede abrirse en un navegador o reenviarse—, y
 * vuelve a comprobarlo todo al usarse. Ver `enlacesFirmados.ts` y
 * `descargas.controller.ts`.
 */
export async function enlacePdfFacturaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const factura = await facturaDelToken(req, res);
    if (!factura) return;

    const pdf = await buscarPdfDeFactura(factura.id);
    if (!pdf) throw new PdfNoDisponible(factura.id);

    const apiKeyId = req.identity?.apiKeyId;
    if (!apiKeyId) throw new Error('enlacePdfFacturaHandler sin apiKeyId: la ruta no pasó por authApiKey()');

    const { token, expira } = firmarEnlace({
      facturaId: factura.id,
      adjuntoId: pdf.adjuntoId,
      partnerId: partnerDelToken(req),
      apiKeyId,
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      data: {
        url: `${req.protocol}://${req.get('host')}/api/v1/descargas/facturas/${token}`,
        expiraEn: new Date(expira * 1000).toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/v1/public/inventory` (#30)
 *
 * El almacén sale del partner del token (ver `inventory.service.ts`). No hay
 * parámetro que lo elija, y no debe haberlo.
 */
export async function listarInventarioHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = inventoryQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: z.prettifyError(query.error) },
      });
      return;
    }

    if (query.data.printerId !== undefined) {
      // Ignorarlo devolvería el catálogo entero a quien pidió los tóners de una
      // impresora. Falta la compatibilidad impresora-tóner: #56.
      res.status(400).json({
        error: {
          code: 'INVALID_QUERY',
          message: 'printerId todavía no está disponible: falta la compatibilidad impresora-tóner.',
        },
      });
      return;
    }

    const partnerId = partnerDelToken(req);
    const almacen = await almacenDelCliente(partnerId);
    if (!almacen) {
      // Un catálogo entero en "agotado" sería una respuesta verosímil y falsa.
      req.log?.warn({ partnerId }, 'inventario: el cliente no tiene compañía o su compañía no tiene almacén');
      // Se LANZA, no se escribe aquí: el status y la forma los pone
      // `errorHandler` desde `HTTP_STATUS_BY_ERROR`. Ver `InventarioNoDisponible`.
      throw new InventarioNoDisponible(partnerId);
    }

    const { pagina, porPagina } = query.data;
    const { items, total, desdeCache } = await listarInventario(almacen, query.data);
    res.json({ data: items, meta: { pagina, porPagina, total, desdeCache } });
  } catch (error) {
    next(error);
  }
}

/** `GET /api/v1/public/recommender/printers` (#39) */
export async function buscarImpresorasHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = printerSearchQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: z.prettifyError(query.error) },
      });
      return;
    }

    const { impresoras, sugerencias } = await buscarImpresoras(query.data.q, query.data.limit);
    res.json({ data: impresoras, sugerencias });
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/v1/public/recommender/printers/:printerId/compatible` (#39)
 *
 * La existencia es la del almacén del cliente del token, como en `/inventory`:
 * sin almacén se responde lo mismo que allí, no una lista entera en "agotado".
 */
export async function compatiblesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = printerIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'printerId debe ser un número entero positivo.' } });
      return;
    }
    const query = compatibleQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY', message: z.prettifyError(query.error) },
      });
      return;
    }

    const partnerId = partnerDelToken(req);
    const almacen = await almacenDelCliente(partnerId);
    if (!almacen) {
      req.log?.warn({ partnerId }, 'recomendador: el cliente no tiene compañía o su compañía no tiene almacén');
      throw new InventarioNoDisponible(partnerId);
    }

    const r = await compatiblesDe(params.data.printerId, almacen, query.data.soloDisponibles);
    res.json({
      data: r.items,
      meta: { impresora: r.impresora, sinCompatibilidadesCargadas: r.sinCompatibilidadesCargadas, desdeCache: r.desdeCache },
    });
  } catch (error) {
    next(error);
  }
}

/** Endpoints declarados en el contrato pero todavía sin implementar. */
export function noImplementadoHandler(_req: Request, res: Response): void {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED' } });
}
