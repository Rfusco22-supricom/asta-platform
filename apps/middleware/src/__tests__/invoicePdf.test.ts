import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema } from '@asta/shared-types';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { executeKw, searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { issueApiKey, revokeApiKey } from '../services/apiKey.service.js';
import { firmarEnlace } from '../services/enlacesFirmados.js';

/**
 * Issue #32 — enlace firmado al PDF de una factura, contra servidor, MySQL y
 * Odoo reales.
 *
 * Este endpoint tiene más superficie que el resto de la API pública: la descarga
 * NO pide API key. Lo que se vigila:
 *
 *   · el PDF que se descarga es, byte a byte, el adjunto de Odoo — contrastado
 *     con el `checksum` (SHA-1) que guarda `ir.attachment`
 *   · pedir el PDF de una factura ajena es el mismo 404 que el detalle, auditado
 *   · un enlace no se puede reutilizar para otra factura, otro adjunto u otro
 *     cliente, ni sobrevive a la revocación de su key ni a perder el scope
 *
 * Fixtures descubiertos de la instancia: una factura de Venezuela con el PDF del
 * informe, una de Panamá con el PDF de facturación electrónica (FEL) y una sin
 * ningún PDF.
 */

let server: Server;
let base = '';
let idBitacoraInicial = 0n;
const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];
const auditados: AuditEvent[] = [];
let quitarSink: () => void;

interface Caso {
  partnerId: number;
  facturaId: number;
  /** null en la factura sin PDF. */
  adjuntoId: number | null;
  key: string;
  keyId: string;
  userId: string;
}

let VE: Caso;
let PA: Caso;
let SIN_PDF: Caso;

async function get(path: string, key?: string) {
  const res = await fetch(`${base}${path}`, { headers: key ? { 'X-API-Key': key } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  let body: { data?: { url: string; expiraEn: string }; error?: { code?: string } } | null = null;
  if ((res.headers.get('content-type') ?? '').includes('json')) body = JSON.parse(buf.toString('utf8'));
  return { status: res.status, body, buf, headers: res.headers };
}

/** Un cuerpo de error tiene que validar contra el contrato, no solo llevar la cadena. */
function errorDelContrato(body: unknown, code: string) {
  const r = apiErrorSchema.safeParse(body);
  expect(r.success, `no valida contra apiErrorSchema: ${JSON.stringify(body)}`).toBe(true);
  expect(r.data?.error.code).toBe(code);
}

/** El camino relativo de la URL que devuelve la API, para pedirlo a este servidor. */
const ruta = (url: string) => new URL(url).pathname;

async function prepararUsuario(partnerId: number, sufijo: string) {
  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (usuario && !['BRONCE', 'PLATA', 'GOLD'].includes(usuario.role)) {
    throw new Error(`El partner ${partnerId} ya pertenece a un usuario con rol ${usuario.role}.`);
  }
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: { email: `test.pdf.${sufijo}@pdf.local`, fullName: `Cliente PDF ${sufijo}`, role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  }
  const k = await issueApiKey({ userId: usuario.id, name: `pdf ${sufijo}`, scopes: ['INVOICES_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(k.id);
  return { userId: usuario.id, key: k.plaintext, keyId: k.id };
}

interface FilaFactura {
  id: number;
  commercial_partner_id: [number, string] | false;
  invoice_pdf_report_id: [number, string] | false;
  message_main_attachment_id: [number, string] | false;
}

/**
 * Una factura de venta contabilizada de la compañía que cumpla `elegir`, cuyo
 * cliente raíz no esté ya usado ni pertenezca a un usuario de otro rol.
 */
async function descubrir(
  companyId: number,
  elegir: (f: FilaFactura, adjuntos: Map<number, string>) => number | null | undefined,
  usados: Set<number>,
): Promise<{ partnerId: number; facturaId: number; adjuntoId: number | null }> {
  const facturas = await searchRead<FilaFactura>(
    'account.move',
    [['company_id', '=', companyId], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
    ['commercial_partner_id', 'invoice_pdf_report_id', 'message_main_attachment_id'],
    { limit: 3000, order: 'id desc' },
  );
  const idsAdj = facturas.flatMap((f) => (f.message_main_attachment_id ? [f.message_main_attachment_id[0]] : []));
  const adjuntos = new Map(
    (await searchRead<{ id: number; name: string }>('ir.attachment', [['id', 'in', idsAdj]], ['name'])).map((a) => [a.id, a.name]),
  );
  const ocupados = new Set(
    (await prisma.appUser.findMany({ where: { role: { notIn: ['BRONCE', 'PLATA', 'GOLD'] } }, select: { odooPartnerId: true } }))
      .map((u) => u.odooPartnerId),
  );
  for (const f of facturas) {
    if (!f.commercial_partner_id) continue;
    const partnerId = f.commercial_partner_id[0];
    if (usados.has(partnerId) || ocupados.has(partnerId)) continue;
    const adjuntoId = elegir(f, adjuntos);
    if (adjuntoId === undefined) continue;
    usados.add(partnerId);
    return { partnerId, facturaId: f.id, adjuntoId };
  }
  throw new Error(`No hay una factura de la compañía ${companyId} para este caso: el test no probaría nada.`);
}

async function checksumOdoo(adjuntoId: number): Promise<string> {
  const [a] = await executeKw<Array<{ checksum: string }>>('ir.attachment', 'read', [[adjuntoId], ['checksum']]);
  return a.checksum;
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  quitarSink = registerAuditSink((e) => auditados.push(e));
  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  const usados = new Set<number>();
  const ve = await descubrir(10, (f) => (f.invoice_pdf_report_id ? f.invoice_pdf_report_id[0] : undefined), usados);
  const pa = await descubrir(
    7,
    (f, adj) =>
      !f.invoice_pdf_report_id && f.message_main_attachment_id && /^FEL-\d+$/.test(adj.get(f.message_main_attachment_id[0]) ?? '')
        ? f.message_main_attachment_id[0]
        : undefined,
    usados,
  );
  const sin = await descubrir(10, (f) => (!f.invoice_pdf_report_id && !f.message_main_attachment_id ? null : undefined), usados);

  VE = { ...ve, ...(await prepararUsuario(ve.partnerId, 've')) };
  PA = { ...pa, ...(await prepararUsuario(pa.partnerId, 'pa')) };
  SIN_PDF = { ...sin, ...(await prepararUsuario(sin.partnerId, 'sin')) };
}, 180_000);

afterAll(async () => {
  quitarSink?.();
  await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#32 · El PDF que se descarga es el de Odoo', () => {
  for (const [nombre, caso] of [['Venezuela (informe)', () => VE], ['Panamá (FEL)', () => PA]] as const) {
    it(`${nombre}: enlace → descarga SIN API key → mismos bytes que ir.attachment`, async () => {
      const c = caso();
      const enlace = await get(`/api/v1/public/invoices/${c.facturaId}/pdf`, c.key);
      expect(enlace.status).toBe(200);
      expect(enlace.headers.get('cache-control')).toBe('no-store');

      const expira = Date.parse(enlace.body?.data?.expiraEn ?? '');
      expect(expira - Date.now()).toBeGreaterThan(4 * 60_000);
      expect(expira - Date.now()).toBeLessThanOrEqual(5 * 60_000);

      const descarga = await get(ruta(enlace.body?.data?.url ?? ''));
      expect(descarga.status).toBe(200);
      expect(descarga.headers.get('content-type')).toBe('application/pdf');
      expect(descarga.headers.get('content-disposition')).toBe(`attachment; filename="factura-${c.facturaId}.pdf"`);
      expect(descarga.headers.get('cache-control')).toBe('no-store');
      expect(descarga.headers.get('x-content-type-options')).toBe('nosniff');
      expect(descarga.buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      const sha1 = createHash('sha1').update(descarga.buf).digest('hex');
      expect(sha1).toBe(await checksumOdoo(c.adjuntoId as number));
    });
  }

  it('una factura sin PDF → 404 INVOICE_PDF_NOT_AVAILABLE, y no emite enlace', async () => {
    const r = await get(`/api/v1/public/invoices/${SIN_PDF.facturaId}/pdf`, SIN_PDF.key);
    expect(r.status).toBe(404);
    errorDelContrato(r.body, 'INVOICE_PDF_NOT_AVAILABLE');
    expect(r.body?.data).toBeUndefined();
  });
});

describe('#32 · Pedir el PDF de otro cliente', () => {
  it('es el MISMO 404 que una factura inexistente, y queda auditado', async () => {
    const ajena = await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`, PA.key);
    const inexistente = await get('/api/v1/public/invoices/999999999/pdf', PA.key);

    expect(ajena.status).toBe(404);
    expect(ajena.body).toEqual(inexistente.body);
    errorDelContrato(ajena.body, 'INVOICE_NOT_FOUND');

    expect(auditados).toContainEqual(
      expect.objectContaining({ action: 'access.denied.partner', targetType: 'account.move', targetId: String(VE.facturaId) }),
    );
  });
});

describe('#32 · Un enlace no sirve para otra cosa', () => {
  it('un enlace de PA firmado para la factura de VE → 404 (la factura no es de PA)', async () => {
    // Firma válida: simula un fallo en la emisión. La descarga no se fía de lo
    // firmado y vuelve a comprobar la propiedad.
    const { token } = firmarEnlace({ facturaId: VE.facturaId, adjuntoId: VE.adjuntoId as number, partnerId: PA.partnerId, apiKeyId: PA.keyId });
    const r = await get(`/api/v1/descargas/facturas/${token}`);
    expect(r.status).toBe(404);
    errorDelContrato(r.body, 'LINK_NOT_VALID');
  });

  it('firmado con la key de OTRO cliente → 404', async () => {
    const { token } = firmarEnlace({ facturaId: VE.facturaId, adjuntoId: VE.adjuntoId as number, partnerId: VE.partnerId, apiKeyId: PA.keyId });
    expect((await get(`/api/v1/descargas/facturas/${token}`)).status).toBe(404);
  });

  it('la factura correcta con OTRO adjunto → 404', async () => {
    // Si solo se comprobara la factura, un enlace podría servir cualquier
    // adjunto por id: el PDF de otra factura, o un documento interno.
    const { token } = firmarEnlace({ facturaId: VE.facturaId, adjuntoId: PA.adjuntoId as number, partnerId: VE.partnerId, apiKeyId: VE.keyId });
    expect((await get(`/api/v1/descargas/facturas/${token}`)).status).toBe(404);
  });

  it('un token alterado → 404', async () => {
    const enlace = await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`, VE.key);
    const url = ruta(enlace.body?.data?.url ?? '');
    const ultimo = url.at(-1) === 'A' ? 'B' : 'A';
    expect((await get(url.slice(0, -1) + ultimo)).status).toBe(404);
  });

  it('un enlace caducado → 410 LINK_EXPIRED', async () => {
    const hace10min = Math.floor(Date.now() / 1000) - 600;
    const { token } = firmarEnlace({ facturaId: VE.facturaId, adjuntoId: VE.adjuntoId as number, partnerId: VE.partnerId, apiKeyId: VE.keyId }, hace10min);
    const r = await get(`/api/v1/descargas/facturas/${token}`);
    expect(r.status).toBe(410);
    errorDelContrato(r.body, 'LINK_EXPIRED');
  });
});

describe('#32 · Un enlace muere con su key', () => {
  it('quitarle INVOICES_READ a la key corta sus enlaces ya emitidos', async () => {
    const propia = await prepararUsuario(VE.partnerId, 've-scope');
    const enlace = await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`, propia.key);
    const url = ruta(enlace.body?.data?.url ?? '');
    expect((await get(url)).status).toBe(200);

    await prisma.apiKeyScope.deleteMany({ where: { apiKeyId: propia.keyId } });
    expect((await get(url)).status).toBe(404);
  });

  it('revocar la key corta sus enlaces ya emitidos', async () => {
    const propia = await prepararUsuario(VE.partnerId, 've-revocada');
    const enlace = await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`, propia.key);
    const url = ruta(enlace.body?.data?.url ?? '');
    expect((await get(url)).status).toBe(200);

    await revokeApiKey({
      apiKeyId: propia.keyId,
      actorId: propia.userId,
      duenoEsperado: propia.userId,
      reason: 'test #32',
    });
    expect((await get(url)).status).toBe(404);
  });
});

describe('#32 · La lista de IPs de la key', () => {
  it('se exige al EMITIR el enlace, pero no al descargar (decisión de #32)', async () => {
    /*
     * Decisión, no descuido. Quien restringe una key por IP es el cliente que
     * integra desde su servidor, y ese servidor pide el enlace para dárselo a
     * otro: un navegador, contabilidad. Exigir la misma IP en la descarga
     * inutilizaría el enlace justo para los clientes más cuidadosos.
     *
     * Lo que acota el riesgo: el enlace se emite desde una IP permitida, dura
     * 5 minutos, abre una sola factura y muere si se revoca la key.
     *
     * Si esto cambia, que sea cambiando este test a propósito.
     */
    const propia = await prepararUsuario(VE.partnerId, 've-ip');
    await prisma.apiKeyAllowedIp.create({ data: { apiKeyId: propia.keyId, cidr: '127.0.0.1' } });

    const enlace = await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`, propia.key);
    expect(enlace.status).toBe(200);
    const url = ruta(enlace.body?.data?.url ?? '');

    // La lista deja de incluir la IP desde la que se descarga: la key ya no
    // podría emitir, pero el enlace emitido sigue abriendo.
    await prisma.apiKeyAllowedIp.deleteMany({ where: { apiKeyId: propia.keyId } });
    await prisma.apiKeyAllowedIp.create({ data: { apiKeyId: propia.keyId, cidr: '203.0.113.7' } });

    expect((await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`, propia.key)).status).toBe(401);
    expect((await get(url)).status).toBe(200);
  });
});

describe('#32 · Rechazos del endpoint del enlace', () => {
  it('sin API key → 401; id no numérico → 400', async () => {
    expect((await get(`/api/v1/public/invoices/${VE.facturaId}/pdf`)).status).toBe(401);
    expect((await get('/api/v1/public/invoices/abc/pdf', VE.key)).status).toBe(400);
  });

  it('las descargas tienen límite por IP', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 40; i++) estados.push((await get(`/api/v1/descargas/facturas/basura${i}.x`)).status);
    expect(estados).toContain(429);
    expect(estados.slice(0, 5).every((s) => s === 404)).toBe(true);
  });
});
