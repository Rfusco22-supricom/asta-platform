import type { ErrorCode } from '@asta/shared-types';
import { executeKw, searchRead } from '../odoo/client.js';

/**
 * Qué PDF es "el PDF de la factura" (#32).
 *
 * No hay un campo único. Medido sobre las 17.180 facturas contabilizadas:
 *
 *   Venezuela (compañías 9 y 10)  `invoice_pdf_report_id`, el PDF que Odoo
 *                                 genera al enviar la factura. Coincide siempre
 *                                 con el adjunto principal.
 *   Panamá (compañía 7)           el PDF de la facturación electrónica,
 *                                 "FEL-0000007416", como adjunto principal.
 *                                 6.012 de 6.021 adjuntos principales.
 *
 * El adjunto principal (`message_main_attachment_id`) NO se sirve a ciegas: es
 * el primer archivo que se sube al chatter de la factura, sea lo que sea. Entre
 * los de Panamá hay `image.png` y otros PDFs que no son la factura. Así que:
 *
 *   1. `invoice_pdf_report_id`, si existe.
 *   2. Si no, el adjunto principal SOLO si se llama `FEL-<número>`.
 *   3. En los dos casos: PDF, colgado de ESTA factura, y de tamaño razonable.
 *
 * Lo que no encaja no se sirve. Una factura sin PDF es un 404 explicable; un
 * documento interno enviado como "la factura" no tiene arreglo.
 *
 * ── Lo que NO se hace ────────────────────────────────────────────────────────
 *
 * Generar el PDF que falta. Unas 4.500 facturas no tienen ninguno (1.438 de
 * Panamá con número FEL pero sin el PDF guardado). Generarlo exige métodos
 * privados del motor de informes, que XML-RPC no expone, o escribir en Odoo. El
 * middleware lee.
 */

/** Un PDF de factura ronda los 40-100 KB. Pasar de esto ya no es una factura. */
export const TAMANIO_MAXIMO_PDF = 10 * 1024 * 1024;

const PATRON_FEL = /^FEL-\d+$/;

interface FilaFactura {
  id: number;
  invoice_pdf_report_id: [number, string] | false;
  message_main_attachment_id: [number, string] | false;
}

interface FilaAdjunto {
  id: number;
  name: string;
  mimetype: string | false;
  file_size: number;
  res_model: string | false;
  res_id: number | false;
}

export interface PdfDeFactura {
  adjuntoId: number;
  origen: 'informe' | 'fel';
}

/**
 * El PDF de una factura, o `null` si no tiene uno que se pueda servir.
 *
 * NO comprueba de quién es la factura: eso lo hace el controlador ANTES, con el
 * partner del token. Aquí solo se decide qué adjunto la representa.
 */
export async function buscarPdfDeFactura(facturaId: number): Promise<PdfDeFactura | null> {
  const [factura] = await searchRead<FilaFactura>(
    'account.move',
    [['id', '=', facturaId]],
    ['invoice_pdf_report_id', 'message_main_attachment_id'],
  );
  if (!factura) return null;

  let candidato: PdfDeFactura | null = null;
  let exigirFel = false;
  if (factura.invoice_pdf_report_id) {
    candidato = { adjuntoId: factura.invoice_pdf_report_id[0], origen: 'informe' };
  } else if (factura.message_main_attachment_id) {
    candidato = { adjuntoId: factura.message_main_attachment_id[0], origen: 'fel' };
    exigirFel = true;
  }
  if (!candidato) return null;

  const [adjunto] = await searchRead<FilaAdjunto>(
    'ir.attachment',
    [['id', '=', candidato.adjuntoId]],
    ['name', 'mimetype', 'file_size', 'res_model', 'res_id'],
  );
  // Sin `res_field` en el dominio, `ir.attachment` oculta los adjuntos de campos
  // binarios, que es justo lo que es `invoice_pdf_report_id`. Buscar por id
  // exacto no pasa por ese filtro.
  if (!adjunto) return null;

  const valido =
    adjunto.mimetype === 'application/pdf' &&
    adjunto.res_model === 'account.move' &&
    adjunto.res_id === facturaId &&
    adjunto.file_size > 0 &&
    adjunto.file_size <= TAMANIO_MAXIMO_PDF &&
    (!exigirFel || PATRON_FEL.test(adjunto.name));

  return valido ? candidato : null;
}

/**
 * Los bytes del adjunto. Lanza si no empiezan como un PDF: el `mimetype` de
 * `ir.attachment` lo pone quien sube el archivo, no se comprueba.
 */
export async function leerPdf(adjuntoId: number): Promise<Buffer> {
  const [fila] = await executeKw<Array<{ datas: string | false }>>('ir.attachment', 'read', [[adjuntoId], ['datas']]);
  if (!fila?.datas) throw new Error(`El adjunto ${adjuntoId} no tiene contenido`);
  const bytes = Buffer.from(fila.datas, 'base64');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`El adjunto ${adjuntoId} no es un PDF aunque lo declare`);
  }
  return bytes;
}

/**
 * La factura es del cliente, pero no tiene un PDF servible.
 *
 * Se lanza DESPUÉS de comprobar la propiedad: distinguir "sin PDF" de "no
 * existe" solo se lo cuenta a quien ya puede ver la factura.
 */
export class PdfNoDisponible extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'INVOICE_PDF_NOT_AVAILABLE';

  constructor(readonly facturaId: number) {
    super('Esta factura no tiene un PDF disponible. Solicítalo a tu vendedor.');
    this.name = 'PdfNoDisponible';
  }
}
