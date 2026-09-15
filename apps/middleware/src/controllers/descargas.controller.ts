import type { Request, Response, NextFunction } from 'express';
import { EnlaceCaducado, EnlaceNoValido, verificarEnlace } from '../services/enlacesFirmados.js';
import { keyVigenteParaEnlace } from '../services/apiKey.service.js';
import { getPartnerInvoice } from '../services/invoicing.service.js';
import { buscarPdfDeFactura, leerPdf } from '../services/invoicePdf.service.js';

/**
 * `GET /api/v1/descargas/facturas/:token` (#32)
 *
 * Sin API key: la autoriza la firma del enlace. Y como la firma solo prueba que
 * el enlace lo emitió este servidor, al usarlo se vuelve a comprobar TODO lo que
 * pudo cambiar en esos 5 minutos:
 *
 *   1. la firma y la caducidad
 *   2. que la key siga vigente, sea del mismo cliente y conserve INVOICES_READ
 *      — revocar una key filtrada corta también sus enlaces
 *   3. que la factura siga siendo de ese cliente
 *   4. que el adjunto firmado siga siendo EL PDF de esa factura
 *
 * Todo fallo es el mismo 404, salvo la caducidad, que es 410: a quien tiene un
 * enlace legítimo le sirve saber que tiene que pedir otro, y no revela nada que
 * el propio token no diga ya.
 */

export async function descargarPdfFacturaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.params.token;
    const verificado = verificarEnlace(typeof token === 'string' ? token : '');
    if (!verificado.ok) {
      throw verificado.motivo === 'CADUCADO' ? new EnlaceCaducado() : new EnlaceNoValido();
    }

    const { facturaId, adjuntoId, partnerId, apiKeyId } = verificado.contenido;

    if (!(await keyVigenteParaEnlace(apiKeyId, partnerId))) {
      req.log?.warn({ apiKeyId, facturaId }, 'descarga de PDF con una key que ya no vale');
      throw new EnlaceNoValido();
    }

    const factura = await getPartnerInvoice(partnerId, facturaId);
    const pdf = factura ? await buscarPdfDeFactura(facturaId) : null;
    if (!factura || pdf?.adjuntoId !== adjuntoId) throw new EnlaceNoValido();

    const bytes = await leerPdf(adjuntoId);

    res.set({
      'Content-Type': 'application/pdf',
      // El nombre NO sale de Odoo: `ir.attachment.name` lo escribe cualquiera
      // que suba un archivo, y en una cabecera es una vía de inyección.
      'Content-Disposition': `attachment; filename="factura-${facturaId}.pdf"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(bytes);
  } catch (error) {
    next(error);
  }
}
