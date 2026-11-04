import type { Response } from 'express';
import { DIAS_VENCE_PRONTO, FACTURAS_POR_PAGINA, vistaFacturasSchema } from '@asta/shared-types';
import { getPartnerInvoice, listPartnerInvoices, resumenDeCobro } from '../services/invoicing.service.js';
import { buscarPdfDeFactura, leerPdf } from '../services/invoicePdf.service.js';
import { fotoDeProducto, tipoDeImagen } from '../services/flyers.service.js';

/**
 * Las respuestas de las pantallas del cliente que no son un `res.json` de un
 * servicio: «Mis facturas», su PDF y la foto de un flyer. Las usan su ruta
 * (`/account`, el cliente del token) y la vista del administrador
 * (`/admin/vista-cliente/:partnerId`), para que las dos digan exactamente lo
 * mismo.
 */

export async function responderFacturas(partnerId: number, query: Record<string, unknown>, res: Response): Promise<void> {
  const vista = vistaFacturasSchema.safeParse(query.vista ?? 'pendientes');
  const pagina = Number(query.pagina ?? 1);
  if (!vista.success || !Number.isInteger(pagina) || pagina < 1 || pagina > 1000) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'vista es «pendientes» o «todas», y pagina un número desde 1.' } });
    return;
  }
  const [resumen, lista] = await Promise.all([
    resumenDeCobro(partnerId, DIAS_VENCE_PRONTO),
    listPartnerInvoices(partnerId, { soloPorPagar: vista.data === 'pendientes', limit: FACTURAS_POR_PAGINA, offset: (pagina - 1) * FACTURAS_POR_PAGINA }),
  ]);
  res.json({ data: { resumen, vista: vista.data, facturas: lista.facturas, pagina, total: lista.total } });
}

/**
 * El PDF de una factura del cliente. Una de otro responde igual que una que no
 * existe, como en `/public/invoices/:id`.
 */
export async function responderPdfFactura(partnerId: number, idPedido: unknown, res: Response): Promise<void> {
  const id = Number(idPedido);
  const noEsta = () => res.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Factura no encontrada.' } });
  if (!Number.isInteger(id) || id <= 0) {
    noEsta();
    return;
  }
  const factura = await getPartnerInvoice(partnerId, id);
  if (!factura) {
    noEsta();
    return;
  }
  const pdf = await buscarPdfDeFactura(factura.id);
  if (!pdf) {
    res.status(404).json({ error: { code: 'INVOICE_PDF_NOT_AVAILABLE', message: 'Esta factura todavía no tiene PDF. Pídeselo a tu vendedor.' } });
    return;
  }
  const bytes = await leerPdf(pdf.adjuntoId);
  res.set({
    'Content-Type': 'application/pdf',
    // El nombre sale del folio, que lo pone Odoo, limpiado: nada que pueda romper la cabecera.
    'Content-Disposition': `attachment; filename="factura-${factura.folio.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf"`,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(bytes);
}

/** La foto de un producto ASTA a la venta. Otro producto, o sin foto: 404. */
export async function responderFotoProducto(idPedido: unknown, res: Response): Promise<void> {
  const id = Number(idPedido);
  const foto = Number.isInteger(id) && id > 0 ? await fotoDeProducto(id) : null;
  if (!foto) {
    res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Ese producto no tiene foto.' } });
    return;
  }
  res.set({ 'Content-Type': tipoDeImagen(foto), 'Content-Length': String(foto.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.end(foto);
}
