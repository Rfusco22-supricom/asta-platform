import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import {
  apiErrorSchema,
  publicCompatibleResponseSchema,
  publicPrinterSearchResponseSchema,
  type PublicCompatibleResponse,
  type PublicPrinterSearchResponse,
} from '@asta/shared-types';
import { createApp } from '../server.js';
import { searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { vaciarCachesInventario } from '../services/inventory.service.js';
import { normalizarModelo } from '../services/recomendador/normalizar.js';
import { vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * #39 · Endpoints del recomendador, contra el servidor, MySQL y Odoo reales.
 *
 * Lo que se vigila por encima de todo: **solo sale lo validado**, en los dos
 * tramos. Una propuesta del importador (#56) que llega al cliente es venderle un
 * tóner que no le sirve.
 *
 * ── Los datos ────────────────────────────────────────────────────────────────
 *
 * Marca, impresoras y cartuchos con nombres que no existen (`ZZ_REC`), creados y
 * borrados aquí. Los productos son reales —la existencia hay que leerla de
 * Odoo—, pero solo se les cuelgan filas de estos cartuchos, que se van con el
 * ON DELETE CASCADE al borrar el cartucho. Nada real se modifica.
 *
 *   P1 activa    ← C1 VALIDADA  → Ta ORIGINAL VALIDADA, Tb PROPUESTA, Tc RECHAZADA
 *                ← C2 PROPUESTA → Td ORIGINAL VALIDADA
 *                ← C3 VALIDADA  → Ta COMPATIBLE VALIDADA, Te ORIGINAL VALIDADA
 *   P2 desactivada, P3 activa sin nada validado
 *
 * Esperado para P1: Ta (compatible, cartuchos C1 y C3) y Te (original). Ni Tb,
 * ni Tc, ni Td.
 */

const MARCA = 'ZZ_REC_MARCA';
const CODIGOS = ['zzrec1', 'zzrec2', 'zzrec3'];

let server: Server;
let base = '';
let idBitacoraInicial = 0n;
const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];
let key = '';
let keySinScope = '';
let comprobado = false;

const P: Record<'P1' | 'P2' | 'P3', number> = { P1: 0, P2: 0, P3: 0 };
const T: Record<'Ta' | 'Tb' | 'Tc' | 'Td' | 'Te', number> = { Ta: 0, Tb: 0, Tc: 0, Td: 0, Te: 0 };

async function get<B>(path: string, k = key) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: { 'X-API-Key': k } });
  return { status: res.status, body: (await res.json()) as B, texto: '' };
}

beforeAll(async () => {
  const yaEsta = await prisma.printerBrand.count({ where: { name: MARCA } });
  const cartuchos = await prisma.cartridge.count({ where: { codeNormalized: { in: CODIGOS } } });
  if (yaEsta || cartuchos) throw new Error(`${MARCA} o sus cartuchos ya existen: el test no puede distinguir lo suyo. Límpialos a mano.`);
  comprobado = true;

  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  // Un cliente de la compañía 10, que tiene almacén de venta.
  const ocupados = new Set((await prisma.appUser.findMany({ select: { odooPartnerId: true } })).map((u) => u.odooPartnerId));
  const partners = await searchRead<{ id: number }>(
    'res.partner',
    [['company_id', '=', 10], ['is_company', '=', true], ['customer_rank', '>', 0]],
    ['id'],
    { limit: 200, order: 'id' },
  );
  const partnerId = partners.find((p) => !ocupados.has(p.id))?.id;
  if (!partnerId) throw new Error('No hay un cliente libre de la compañía 10 para el test.');
  const usuario = await prisma.appUser.create({
    data: { email: 'test.recomendador@recomendador.local', fullName: 'Cliente recomendador', role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
  });
  usuariosCreados.push(usuario.id);
  const k1 = await issueApiKey({ userId: usuario.id, name: 'recomendador', scopes: ['RECOMMENDER_READ', 'INVENTORY_READ'], rateLimitPerMinute: 1000 });
  const k2 = await issueApiKey({ userId: usuario.id, name: 'recomendador sin scope', scopes: ['INVENTORY_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(k1.id, k2.id);
  key = k1.plaintext;
  keySinScope = k2.plaintext;

  // Cinco plantillas de consumibles a la venta y visibles para cualquier compañía.
  const productos = await searchRead<{ product_tmpl_id: [number, string] }>(
    'product.product',
    [['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['company_id', '=', false], ['categ_id', 'child_of', 2614]],
    ['product_tmpl_id'],
    { limit: 60, order: 'id' },
  );
  const plantillas = [...new Set(productos.map((p) => p.product_tmpl_id[0]))];
  if (plantillas.length < 5) throw new Error('Hacen falta 5 consumibles a la venta para el test.');
  [T.Ta, T.Tb, T.Tc, T.Td, T.Te] = plantillas;

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const impresora = (name: string, isActive = true) =>
    prisma.printerModel.create({ data: { brandId: marca.id, name, nameNormalized: normalizarModelo(name), isActive } });
  const p1 = await impresora('ZZ-Rec 9991dw');
  const p2 = await impresora('ZZ-Rec 9992dw', false);
  const p3 = await impresora('ZZ-Rec 9993');
  [P.P1, P.P2, P.P3] = [p1.id, p2.id, p3.id];
  await prisma.printerModelAlias.createMany({
    data: [
      { printerModelId: p1.id, alias: 'zzcorto991', aliasNormalized: 'zzcorto991', source: 'MANUAL' },
      { printerModelId: p1.id, alias: 'zzretirado991', aliasNormalized: 'zzretirado991', source: 'MANUAL', isActive: false },
    ],
  });

  const cartucho = (code: string, extra: { color?: string; yieldPages?: number } = {}) =>
    prisma.cartridge.create({ data: { brandId: marca.id, code, codeNormalized: normalizarModelo(code), kind: 'TONER', ...extra } });
  const c1 = await cartucho('ZZREC1', { color: 'negro', yieldPages: 3000 });
  const c2 = await cartucho('ZZREC2');
  const c3 = await cartucho('ZZREC3');

  await prisma.cartridgePrinterModel.createMany({
    data: [
      { cartridgeId: c1.id, printerModelId: p1.id, source: 'MANUAL', status: 'VALIDADA' },
      { cartridgeId: c2.id, printerModelId: p1.id, source: 'MANUAL', status: 'PROPUESTA' },
      { cartridgeId: c3.id, printerModelId: p1.id, source: 'MANUAL', status: 'VALIDADA' },
      // P2 desactivada, con una compatibilidad validada: la desactivación manda.
      { cartridgeId: c1.id, printerModelId: p2.id, source: 'MANUAL', status: 'VALIDADA' },
    ],
  });
  await prisma.productCartridge.createMany({
    data: [
      { odooProductTmplId: T.Ta, cartridgeId: c1.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' },
      { odooProductTmplId: T.Tb, cartridgeId: c1.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'PROPUESTA' },
      { odooProductTmplId: T.Tc, cartridgeId: c1.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'RECHAZADA' },
      { odooProductTmplId: T.Td, cartridgeId: c2.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' },
      { odooProductTmplId: T.Ta, cartridgeId: c3.id, relation: 'COMPATIBLE', source: 'MANUAL', status: 'VALIDADA' },
      { odooProductTmplId: T.Te, cartridgeId: c3.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' },
    ],
  });

  vaciarCachesRecomendador();
  vaciarCachesInventario();
}, 180_000);

afterAll(async () => {
  // Vitest ejecuta afterAll aunque beforeAll falle: sin la comprobación, lo que
  // haya con estos nombres no es de este test.
  if (comprobado) {
    await prisma.cartridge.deleteMany({ where: { codeNormalized: { in: CODIGOS }, brand: { name: MARCA } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#39 · Buscar impresoras', () => {
  it('encuentra por nombre y por alias activo, y cumple el schema', async () => {
    for (const q of ['zzrec9991', 'ZZ-Rec 9991 DW', 'zzcorto991']) {
      const r = await get<PublicPrinterSearchResponse>(`/recommender/printers?q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
      expect(publicPrinterSearchResponseSchema.safeParse(r.body).success).toBe(true);
      expect(r.body.data.map((p) => p.id), q).toContain(P.P1);
    }
  });

  it('no encuentra por un alias desactivado', async () => {
    const r = await get<PublicPrinterSearchResponse>('/recommender/printers?q=zzretirado991');
    expect(r.body.data.map((p) => p.id)).not.toContain(P.P1);
  });

  it('una impresora desactivada no sale ni como coincidencia ni como sugerencia', async () => {
    const r = await get<PublicPrinterSearchResponse>('/recommender/printers?q=zzrec9992dw');
    expect([...r.body.data, ...r.body.sugerencias].map((p) => p.id)).not.toContain(P.P2);
  });

  it('solo publica id, marca y nombre', async () => {
    const r = await get<PublicPrinterSearchResponse>('/recommender/printers?q=zzrec9991dw');
    expect(Object.keys(r.body.data[0]).sort()).toEqual(['id', 'marca', 'nombre']);
  });

  it('q de menos de 2 caracteres → 400 INVALID_QUERY', async () => {
    const r = await get<unknown>('/recommender/printers?q=z');
    expect(r.status).toBe(400);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('INVALID_QUERY');
  });
});

describe('#39 · Productos compatibles', () => {
  let r: { status: number; body: PublicCompatibleResponse };

  beforeAll(async () => {
    r = await get<PublicCompatibleResponse>(`/recommender/printers/${P.P1}/compatible`);
  });

  it('cumple el schema', () => {
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = publicCompatibleResponseSchema.safeParse(r.body);
    expect(v.success, JSON.stringify(v.error?.issues)).toBe(true);
    expect(r.body.meta.impresora).toEqual({ id: P.P1, marca: MARCA, nombre: 'ZZ-Rec 9991dw' });
    expect(r.body.meta.sinCompatibilidadesCargadas).toBe(false);
  });

  it('solo lo validado en los dos tramos: ni PROPUESTA, ni RECHAZADA, ni un cartucho sin validar', () => {
    const plantillas = new Set(r.body.data.map((p) => p.templateId));
    expect([...plantillas].sort()).toEqual([T.Ta, T.Te].sort());
  });

  it('compatible si CUALQUIERA de sus cartuchos lo es; con los datos del cartucho', () => {
    const ta = r.body.data.find((p) => p.templateId === T.Ta)!;
    const te = r.body.data.find((p) => p.templateId === T.Te)!;
    expect(ta.tipo).toBe('compatible');
    expect(te.tipo).toBe('original');
    expect(ta.cartuchos).toEqual([
      { marca: MARCA, codigo: 'ZZREC1', tipo: 'toner', color: 'negro', rendimientoPaginas: 3000 },
      { marca: MARCA, codigo: 'ZZREC3', tipo: 'toner', color: null, rendimientoPaginas: null },
    ]);
  });

  it('sin precios, costos ni datos de la revisión', () => {
    // Sobre las CLAVES, no el texto: un nombre de producto puede decir "costo".
    const claves = new Set<string>();
    const recorrer = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(recorrer);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (claves.add(k.toLowerCase()), recorrer(x));
    };
    recorrer(r.body);
    for (const campo of ['precio', 'price', 'cost', 'status', 'evidence', 'review', 'qty']) {
      expect([...claves].filter((k) => k.includes(campo)), campo).toEqual([]);
    }
  });

  it('primero lo que hay en existencia', () => {
    const orden = { disponible: 0, bajo: 1, agotado: 2 };
    const rangos = r.body.data.map((p) => orden[p.stock]);
    expect(rangos).toEqual([...rangos].sort((a, b) => a - b));
  });

  it('la existencia es la misma que publica /inventory para ese cliente', async () => {
    const conSku = r.body.data.filter((p) => p.sku);
    expect(conSku.length).toBeGreaterThan(0);
    for (const p of conSku) {
      const inv = await get<{ data: Array<{ id: number; stock: string }> }>(`/inventory?sku=${encodeURIComponent(p.sku!)}`);
      expect(inv.body.data.find((i) => i.id === p.id)?.stock, p.sku!).toBe(p.stock);
    }
  });

  it('soloDisponibles=true no devuelve agotados', async () => {
    const s = await get<PublicCompatibleResponse>(`/recommender/printers/${P.P1}/compatible?soloDisponibles=true`);
    expect(s.status).toBe(200);
    expect(s.body.data.every((p) => p.stock !== 'agotado')).toBe(true);
    expect(s.body.data.length).toBe(r.body.data.filter((p) => p.stock !== 'agotado').length);
  });

  it('la segunda petición sale de la cache', async () => {
    const s = await get<PublicCompatibleResponse>(`/recommender/printers/${P.P1}/compatible`);
    expect(s.body.meta.desdeCache).toBe(true);
    expect(s.body.data).toEqual(r.body.data);
  });
});

describe('#39 · Casos límite y errores', () => {
  it('impresora sin nada validado → data vacío y sinCompatibilidadesCargadas', async () => {
    const r = await get<PublicCompatibleResponse>(`/recommender/printers/${P.P3}/compatible`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.meta.sinCompatibilidadesCargadas).toBe(true);
  });

  it('desactivada o inexistente → el mismo 404 PRINTER_NOT_FOUND', async () => {
    const a = await get<unknown>(`/recommender/printers/${P.P2}/compatible`);
    const b = await get<unknown>('/recommender/printers/4000000000/compatible');
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.body).toEqual(b.body);
    expect(apiErrorSchema.parse(a.body).error.code).toBe('PRINTER_NOT_FOUND');
  });

  it('printerId no válido, o fuera del rango de la columna → 400, no 500', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '99999999999']) {
      const r = await get<unknown>(`/recommender/printers/${id}/compatible`);
      expect(r.status, id).toBe(400);
      expect(apiErrorSchema.parse(r.body).error.code).toBe('INVALID_QUERY');
    }
  });

  it('sin el permiso RECOMMENDER_READ → 403 en los dos endpoints', async () => {
    for (const ruta of ['/recommender/printers?q=zzrec9991', `/recommender/printers/${P.P1}/compatible`]) {
      const r = await get<unknown>(ruta, keySinScope);
      expect(r.status, ruta).toBe(403);
      expect(apiErrorSchema.parse(r.body).error.code).toBe('INSUFFICIENT_SCOPE');
    }
  });
});
