import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #32 · Qué adjunto se sirve como "el PDF de la factura", con Odoo simulado.
 *
 * Los casos de rechazo existen en la instancia —adjuntos principales que son
 * `image.png` u otros PDFs—, pero son un puñado y pueden desaparecer. Se fijan
 * aquí para que el test no dependa de que sigan ahí.
 */

const searchRead = vi.fn();
const executeKw = vi.fn();
vi.mock('../odoo/client.js', () => ({ searchRead, executeKw }));

const { buscarPdfDeFactura, leerPdf, TAMANIO_MAXIMO_PDF } = await import('../services/invoicePdf.service.js');

interface Escenario {
  report?: number | false;
  main?: number | false;
  adjunto?: Partial<{ name: string; mimetype: string | false; file_size: number; res_model: string | false; res_id: number | false }> | null;
}

const FACTURA = 500;

function odoo({ report = false, main = false, adjunto = {} }: Escenario) {
  searchRead.mockImplementation(async (modelo: string, dominio: Array<[string, string, number]>) => {
    if (modelo === 'account.move') {
      return [{ id: FACTURA, invoice_pdf_report_id: report ? [report, 'x'] : false, message_main_attachment_id: main ? [main, 'x'] : false }];
    }
    if (modelo === 'ir.attachment') {
      if (adjunto === null) return [];
      return [{ id: dominio[0][2], name: 'FEL-0000007416', mimetype: 'application/pdf', file_size: 90_000, res_model: 'account.move', res_id: FACTURA, ...adjunto }];
    }
    throw new Error(modelo);
  });
}

beforeEach(() => {
  searchRead.mockReset();
  executeKw.mockReset();
});

describe('#32 · buscarPdfDeFactura', () => {
  it('prefiere el PDF del informe (Venezuela)', async () => {
    odoo({ report: 1, main: 2, adjunto: { name: '5038026.pdf' } });
    expect(await buscarPdfDeFactura(FACTURA)).toEqual({ adjuntoId: 1, origen: 'informe' });
  });

  it('sin informe, acepta el adjunto principal si es un FEL (Panamá)', async () => {
    odoo({ main: 2 });
    expect(await buscarPdfDeFactura(FACTURA)).toEqual({ adjuntoId: 2, origen: 'fel' });
  });

  it('el adjunto principal que NO es un FEL no se sirve, aunque sea PDF', async () => {
    // Es el primer archivo subido al chatter: puede ser la orden de compra del
    // cliente o un documento interno.
    for (const name of ['SBCM-1.pdf', 'INV_2026_1.pdf', 'FEL-12.pdf', 'xFEL-12', 'FEL-']) {
      odoo({ main: 2, adjunto: { name } });
      expect(await buscarPdfDeFactura(FACTURA)).toBeNull();
    }
  });

  it('no PDF, de otra factura, de otro modelo, vacío o enorme → null', async () => {
    const malos: Escenario['adjunto'][] = [
      { mimetype: 'image/png' },
      { mimetype: false },
      { res_id: FACTURA + 1 },
      { res_model: 'sale.order' },
      { res_model: false },
      { file_size: 0 },
      { file_size: TAMANIO_MAXIMO_PDF + 1 },
    ];
    for (const adjunto of malos) {
      odoo({ report: 1, adjunto });
      expect(await buscarPdfDeFactura(FACTURA), JSON.stringify(adjunto)).toBeNull();
    }
  });

  it('el tamaño máximo exacto se acepta', async () => {
    odoo({ report: 1, adjunto: { file_size: TAMANIO_MAXIMO_PDF } });
    expect(await buscarPdfDeFactura(FACTURA)).not.toBeNull();
  });

  it('sin informe ni adjunto principal, o adjunto ilegible → null', async () => {
    odoo({});
    expect(await buscarPdfDeFactura(FACTURA)).toBeNull();
    odoo({ report: 1, adjunto: null });
    expect(await buscarPdfDeFactura(FACTURA)).toBeNull();
  });
});

describe('#32 · leerPdf', () => {
  it('devuelve los bytes de un PDF', async () => {
    const pdf = Buffer.from('%PDF-1.7\n...');
    executeKw.mockResolvedValue([{ datas: pdf.toString('base64') }]);
    expect(await leerPdf(1)).toEqual(pdf);
  });

  it('lanza si el contenido no es un PDF aunque el adjunto lo declare', async () => {
    // El mimetype lo pone quien sube el archivo. Un HTML servido como
    // application/pdf con nombre "factura" no puede salir de aquí.
    executeKw.mockResolvedValue([{ datas: Buffer.from('<html><script>').toString('base64') }]);
    await expect(leerPdf(1)).rejects.toThrow(/no es un PDF/);
  });

  it('lanza si el adjunto no tiene contenido', async () => {
    executeKw.mockResolvedValue([{ datas: false }]);
    await expect(leerPdf(1)).rejects.toThrow(/no tiene contenido/);
  });
});
