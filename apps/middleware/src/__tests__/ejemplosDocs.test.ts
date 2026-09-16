import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { construirOpenApi, OPERACIONES, urlDeEjemplo } from '../openapi/especificacion.js';
import { normalizarModelo } from '../services/recomendador/normalizar.js';
import { vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * #35 · Los ejemplos de la documentación funcionan.
 *
 * El criterio del issue es que un cliente integre sin llamar a soporte, y lo
 * primero que hace un cliente es copiar un ejemplo. Aquí se ejecuta, contra el
 * servidor, MySQL y Odoo reales, la MISMA petición de la que salen el `curl` y
 * el Python de cada endpoint (`urlDeEjemplo`), y la respuesta se valida contra el
 * schema que documenta ese endpoint.
 *
 * No se lanzan `curl` ni `python` de verdad: el equipo trabaja en Windows, donde
 * ninguno de los dos está garantizado (ver #88). Los comandos se generan desde
 * la misma estructura, y `docsApi.test.ts` comprueba lo demás.
 */

let server: Server;
let base = '';
let idBitacoraInicial = 0n;
const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];
let key = '';
/** Valores reales para los `{marcadores}` de las rutas de ejemplo. */
const valores: Record<string, string> = {};

/**
 * Compatibilidad de ejemplo para el recomendador (#39). La base de desarrollo
 * puede no tener ninguna validada, y un ejemplo que devuelve `data: []` no
 * enseña nada.
 *
 * La impresora del ejemplo puede existir de verdad: si existe se usa y NO se
 * borra. El cartucho lleva un código que no existe (`ZZDOCS404`) y es lo único
 * que se crea siempre; al borrarlo, el ON DELETE CASCADE se lleva sus dos filas
 * de compatibilidad y nada más.
 */
const CARTUCHO_DOCS = 'zzdocs404';
const fixture: { comprobado: boolean; marcaCreada?: number; impresoraCreada?: number } = { comprobado: false };

beforeAll(async () => {
  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  // Un cliente de Venezuela con una factura que TIENE PDF del informe: sirve
  // para los cinco endpoints, porque su compañía tiene almacén de venta.
  const facturas = await searchRead<{ id: number; commercial_partner_id: [number, string] | false; invoice_pdf_report_id: [number, string] | false }>(
    'account.move',
    // Sin pagar: el ejemplo del listado filtra por `estadoPago=not_paid`.
    [['company_id', '=', 10], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', '=', 'not_paid']],
    ['commercial_partner_id', 'invoice_pdf_report_id'],
    { limit: 3000, order: 'id desc' },
  );
  const ocupados = new Set(
    (await prisma.appUser.findMany({ where: { role: { notIn: ['BRONCE', 'PLATA', 'GOLD'] } }, select: { odooPartnerId: true } })).map((u) => u.odooPartnerId),
  );
  const elegida = facturas.find((f) => f.invoice_pdf_report_id && f.commercial_partner_id && !ocupados.has(f.commercial_partner_id[0]));
  if (!elegida || !elegida.commercial_partner_id) throw new Error('No hay una factura con PDF para los ejemplos: el test no probaría nada.');
  const partnerId = elegida.commercial_partner_id[0];
  valores.id = String(elegida.id);

  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: { email: 'test.docs@docs.local', fullName: 'Cliente docs', role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  }
  const k = await issueApiKey({ userId: usuario.id, name: 'ejemplos docs', scopes: ['INVOICES_READ', 'INVENTORY_READ', 'RECOMMENDER_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(k.id);
  key = k.plaintext;

  // ── Recomendador ──────────────────────────────────────────────────────────
  if (await prisma.cartridge.count({ where: { codeNormalized: CARTUCHO_DOCS } })) {
    throw new Error(`El cartucho ${CARTUCHO_DOCS} ya existe: el test no puede distinguir lo suyo. Límpialo a mano.`);
  }
  fixture.comprobado = true;

  const [producto] = await searchRead<{ product_tmpl_id: [number, string] }>(
    'product.product',
    [['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['company_id', '=', false], ['categ_id', 'child_of', 2614]],
    ['product_tmpl_id'],
    { limit: 1, order: 'id' },
  );
  if (!producto) throw new Error('No hay un consumible a la venta para el ejemplo del recomendador.');

  let marca = await prisma.printerBrand.findUnique({ where: { name: 'HP' } });
  if (!marca) {
    marca = await prisma.printerBrand.create({ data: { name: 'HP' } });
    fixture.marcaCreada = marca.id;
  }
  const nombre = 'LaserJet Pro M404dn';
  let impresora = await prisma.printerModel.findUnique({
    where: { brandId_nameNormalized: { brandId: marca.id, nameNormalized: normalizarModelo(nombre) } },
  });
  if (impresora && !impresora.isActive) throw new Error(`La impresora ${nombre} existe pero está desactivada: el ejemplo daría 404.`);
  if (!impresora) {
    impresora = await prisma.printerModel.create({ data: { brandId: marca.id, name: nombre, nameNormalized: normalizarModelo(nombre) } });
    fixture.impresoraCreada = impresora.id;
  }
  valores.printerId = String(impresora.id);

  await prisma.cartridge.create({
    data: {
      brandId: marca.id,
      code: 'ZZDOCS404',
      codeNormalized: CARTUCHO_DOCS,
      kind: 'TONER',
      printerModels: { create: { printerModelId: impresora.id, source: 'MANUAL', status: 'VALIDADA' } },
      products: { create: { odooProductTmplId: producto.product_tmpl_id[0], relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' } },
    },
  });
  vaciarCachesRecomendador();
}, 180_000);

afterAll(async () => {
  // Vitest ejecuta afterAll aunque beforeAll falle: sin la comprobación hecha,
  // el cartucho que haya con ese código no es de este test.
  if (fixture.comprobado) {
    await prisma.cartridge.deleteMany({ where: { codeNormalized: CARTUCHO_DOCS } });
    if (fixture.impresoraCreada) await prisma.printerModel.deleteMany({ where: { id: fixture.impresoraCreada } });
    if (fixture.marcaCreada) {
      await prisma.printerBrand.deleteMany({ where: { id: fixture.marcaCreada, cartridges: { none: {} }, printerModels: { none: {} } } });
    }
  }
  await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

describe('#35 · Cada ejemplo, ejecutado', () => {
  for (const op of OPERACIONES) {
    it(`${op.id}: la petición del ejemplo responde 200 y cumple su schema`, async () => {
      if (op.ejemplo.binario) {
        // La descarga usa la URL que devuelve el endpoint del enlace, como dice
        // el ejemplo: primero se pide, luego se descarga.
        const enlace = await fetch(`${base}/api/v1/public/invoices/${valores.id}/pdf`, { headers: { 'X-API-Key': key } });
        const { data } = (await enlace.json()) as { data: { url: string } };
        const r = await fetch(`${base}${new URL(data.url).pathname}`);
        expect(r.status).toBe(200);
        expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
        return;
      }

      const r = await fetch(urlDeEjemplo(base, op.ejemplo, valores), { headers: op.ejemplo.conKey ? { 'X-API-Key': key } : {} });
      const cuerpo = await r.json();
      expect(r.status, JSON.stringify(cuerpo)).toBe(200);

      const valida = op.exito.schema!.safeParse(cuerpo);
      expect(valida.success, JSON.stringify(valida.error?.issues)).toBe(true);
    });
  }

  it('los listados de ejemplo no vuelven vacíos', async () => {
    // Un ejemplo que siempre devuelve `data: []` "cumple el schema" y no enseña
    // nada a quien lo copia.
    for (const op of OPERACIONES.filter((o) => o.query)) {
      const r = await fetch(urlDeEjemplo(base, op.ejemplo, valores), { headers: { 'X-API-Key': key } });
      const { data } = (await r.json()) as { data: unknown[] };
      expect(data.length, op.id).toBeGreaterThan(0);
    }
  });
});

describe('#35 · Lo que sirve el servidor', () => {
  it('GET /api/v1/docs devuelve la página, con los ejemplos apuntando a este servidor', async () => {
    const r = await fetch(`${base}/api/v1/docs`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    const html = await r.text();
    expect(html).toContain(`${base}/api/v1/public/invoices`);
    expect(html).toContain('id="autenticacion"');
  });

  it('GET /api/v1/docs/openapi.json es la especificación, con este servidor', async () => {
    const r = await fetch(`${base}/api/v1/docs/openapi.json`);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(await r.json()).toEqual(construirOpenApi(base));
  });

  it('el enlace `docs` del 401 lleva a la sección de autenticación, que existe', async () => {
    // Antes apuntaba a https://docs.asta.mx, un dominio que no es del proyecto.
    const r = await fetch(`${base}/api/v1/public/invoices`);
    const cuerpo = await r.json();
    expect(apiErrorSchema.safeParse(cuerpo).success).toBe(true);

    const docs = new URL((cuerpo as { error: { docs: string } }).error.docs);
    expect(`${docs.origin}${docs.pathname}`).toBe(`${base}/api/v1/docs`);
    const pagina = await (await fetch(`${docs.origin}${docs.pathname}`)).text();
    expect(pagina).toContain(`id="${docs.hash.slice(1)}"`);
  });

  it('la documentación no pide API key', async () => {
    expect((await fetch(`${base}/api/v1/docs`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/docs/openapi.json`)).status).toBe(200);
  });
});
