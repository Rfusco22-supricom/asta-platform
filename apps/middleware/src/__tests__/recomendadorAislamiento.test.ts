import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema, type PublicCompatibleResponse, type PublicPrinterSearchResponse } from '@asta/shared-types';
import { createApp } from '../server.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { vaciarCachesInventario } from '../services/inventory.service.js';
import { normalizarModelo } from '../services/recomendador/normalizar.js';
import { dominioCompatibles, vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * #39 · Revisión cruzada de #108: lo que `recomendador.test.ts` no vigilaba.
 *
 * Verificado por mutación: estos cambios pasaban toda la batería del recomendador.
 *
 *   X1  la cache de compatibles sin el almacén en la clave
 *   X2  quitar el filtro de compañía del producto
 *   X3  quitar `sale_ok`
 *   X4  un cliente sin almacén recibe una lista en vez del 409
 *   X9  `limit` ignorado en la búsqueda
 *
 * X1 es el que importa: es una fuga entre clientes. La existencia depende del
 * almacén del cliente del token, y con una clave de cache sin almacén el primero
 * que pregunta por una impresora fija lo que ven durante 60 s los demás, también
 * los de otro país. Es la misma fuga que `inventario.test.ts` cubre en
 * `/inventory` y que aquí nadie cubría: el test existente usa UN solo cliente.
 *
 * ── Datos ────────────────────────────────────────────────────────────────────
 *
 * Marca, impresoras y cartucho `ZZ_AIS`, creados y borrados aquí. Los productos
 * son reales: la existencia se lee de Odoo y se contrasta con `stock.quant`, por
 * otro camino que el servicio.
 */

const MARCA = 'ZZ_AIS_MARCA';
const CODIGO = 'zzais1';

let server: Server;
let base = '';
let comprobado = false;
let idBitacoraInicial = 0n;
let idTelemetriaInicial = 0n;
const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];

interface Cliente {
  partnerId: number;
  companyId: number;
  warehouseId: number;
  key: string;
}
let A: Cliente;
let B: Cliente;
let keySinAlmacen = '';

let impresora = 0;
/** Producto con existencia libre holgada en el almacén de A y ninguna en el de B. */
let producto = { id: 0, templateId: 0 };

async function get<T>(path: string, key: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: { 'X-API-Key': key } });
  return { status: res.status, body: (await res.json()) as T };
}

async function almacenSegunVentas(companyId: number): Promise<number> {
  const grupos = await readGroup<{ warehouse_id: [number, string] | false; __count: number }>(
    'sale.order',
    [['company_id', '=', companyId], ['state', 'in', ['sale', 'done']]],
    [],
    ['warehouse_id'],
  );
  const [mayor] = grupos.filter((g) => g.warehouse_id).sort((a, b) => b.__count - a.__count);
  if (!mayor?.warehouse_id) throw new Error(`La compañía ${companyId} no tiene ventas con almacén.`);
  return mayor.warehouse_id[0];
}

async function libreSegunQuants(warehouseId: number, productIds: number[]): Promise<Map<number, number>> {
  const [wh] = await searchRead<{ view_location_id: [number, string] }>('stock.warehouse', [['id', '=', warehouseId]], ['view_location_id']);
  const quants = await searchRead<{ product_id: [number, string]; quantity: number; reserved_quantity: number }>(
    'stock.quant',
    [['product_id', 'in', productIds], ['location_id', 'child_of', wh.view_location_id[0]], ['location_id.usage', '=', 'internal']],
    ['product_id', 'quantity', 'reserved_quantity'],
  );
  const libre = new Map<number, number>(productIds.map((id) => [id, 0]));
  for (const q of quants) libre.set(q.product_id[0], (libre.get(q.product_id[0]) ?? 0) + q.quantity - q.reserved_quantity);
  return libre;
}

async function clienteLibre(companyId: number | false, ocupados: Set<number>): Promise<number> {
  const partners = await searchRead<{ id: number }>(
    'res.partner',
    [['company_id', '=', companyId], ['customer_rank', '>', 0], ['parent_id', '=', false]],
    ['id'],
    { limit: 300, order: 'id' },
  );
  const libre = partners.find((p) => !ocupados.has(p.id))?.id;
  if (!libre) throw new Error(`No hay un cliente libre de la compañía ${companyId}.`);
  ocupados.add(libre);
  return libre;
}

async function nuevoUsuario(partnerId: number, sufijo: string): Promise<string> {
  const u = await prisma.appUser.create({
    data: { email: `test.reco.ais.${sufijo}@aislamiento.local`, fullName: `Reco ${sufijo}`, role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
  });
  usuariosCreados.push(u.id);
  const k = await issueApiKey({ userId: u.id, name: `reco ais ${sufijo}`, scopes: ['RECOMMENDER_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(k.id);
  return k.plaintext;
}

beforeAll(async () => {
  const ya = (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.cartridge.count({ where: { codeNormalized: CODIGO } }));
  if (ya) throw new Error(`${MARCA} o su cartucho ya existen: el test no puede distinguir lo suyo. Límpialos a mano.`);
  comprobado = true;

  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;
  // Desde #43 el recomendador escribe recommendation_events: se borra lo de este test.
  idTelemetriaInicial = (await prisma.recommendationEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? 0n;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  // Dos clientes de compañías con almacenes distintos, y uno sin compañía.
  const ocupados = new Set((await prisma.appUser.findMany({ select: { odooPartnerId: true } })).map((u) => u.odooPartnerId));
  const [wA, wB] = await Promise.all([almacenSegunVentas(10), almacenSegunVentas(9)]);
  if (wA === wB) throw new Error('Las compañías 10 y 9 venden desde el mismo almacén: el test no probaría nada.');
  const pA = await clienteLibre(10, ocupados);
  const pB = await clienteLibre(9, ocupados);
  const pSin = await clienteLibre(false, ocupados);
  A = { partnerId: pA, companyId: 10, warehouseId: wA, key: await nuevoUsuario(pA, 'a') };
  B = { partnerId: pB, companyId: 9, warehouseId: wB, key: await nuevoUsuario(pB, 'b') };
  keySinAlmacen = await nuevoUsuario(pSin, 'sin');

  // Un consumible con existencia holgada en el almacén de A y ninguna en el de B,
  // según los quants: es el caso que delata una cache compartida entre almacenes.
  const candidatos = await searchRead<{ id: number; product_tmpl_id: [number, string] }>(
    'product.product',
    [['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['company_id', '=', false], ['categ_id', 'child_of', 2614]],
    ['product_tmpl_id'],
    { limit: 500, order: 'id desc' },
  );
  const ids = candidatos.map((c) => c.id);
  const [libreA, libreB] = await Promise.all([libreSegunQuants(wA, ids), libreSegunQuants(wB, ids)]);
  const elegido = candidatos.find((c) => (libreA.get(c.id) ?? 0) > 20 && (libreB.get(c.id) ?? 0) <= 0);
  if (!elegido) throw new Error('No hay un consumible con existencia solo en el almacén de A: el test no probaría nada.');
  // Una sola variante por plantilla, para que la respuesta tenga un solo producto.
  const variantes = await searchRead<{ id: number }>('product.product', [['product_tmpl_id', '=', elegido.product_tmpl_id[0]]], ['id']);
  if (variantes.length !== 1) throw new Error('El consumible elegido tiene varias variantes.');
  producto = { id: elegido.id, templateId: elegido.product_tmpl_id[0] };

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const crear = (name: string) => prisma.printerModel.create({ data: { brandId: marca.id, name, nameNormalized: normalizarModelo(name) } });
  const p1 = await crear('ZZ-Ais 7771dw');
  const p2 = await crear('ZZ-Ais 7772dw');
  const p3 = await crear('ZZ-Ais 7773dw');
  impresora = p1.id;
  const cartucho = await prisma.cartridge.create({ data: { brandId: marca.id, code: 'ZZAIS1', codeNormalized: CODIGO, kind: 'TONER' } });
  // Las tres con el cartucho VALIDADO: desde #115 una impresora sin ninguno no
  // es pública, y el test de `limit` necesita tres coincidencias visibles.
  await prisma.cartridgePrinterModel.createMany({
    data: [p1, p2, p3].map((p) => ({ cartridgeId: cartucho.id, printerModelId: p.id, source: 'MANUAL' as const, status: 'VALIDADA' as const })),
  });
  await prisma.productCartridge.create({
    data: { odooProductTmplId: producto.templateId, cartridgeId: cartucho.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' },
  });

  vaciarCachesRecomendador();
  vaciarCachesInventario();
}, 180_000);

afterAll(async () => {
  if (comprobado) {
    await prisma.cartridge.deleteMany({ where: { codeNormalized: CODIGO, brand: { name: MARCA } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
    await prisma.recommendationEvent.deleteMany({ where: { id: { gt: idTelemetriaInicial } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#108 · X1 · La cache de compatibles no cruza clientes', () => {
  it('la MISMA impresora, con dos keys seguidas, da la existencia del almacén de cada una', async () => {
    const ruta = `/recommender/printers/${impresora}/compatible`;
    const deA = await get<PublicCompatibleResponse>(ruta, A.key);
    const deB = await get<PublicCompatibleResponse>(ruta, B.key);

    expect(deA.status).toBe(200);
    expect(deB.status).toBe(200);
    expect(deA.body.data.map((p) => p.id)).toEqual([producto.id]);
    expect(deB.body.data.map((p) => p.id)).toEqual([producto.id]);

    expect(deA.body.data[0].stock).not.toBe('agotado');
    expect(deB.body.data[0].stock).toBe('agotado');
    expect(deB.body.meta.desdeCache).toBe(false);

    // Y dentro del mismo almacén la cache sí sirve.
    const otraVezA = await get<PublicCompatibleResponse>(ruta, A.key);
    expect(otraVezA.body.meta.desdeCache).toBe(true);
    expect(otraVezA.body.data).toEqual(deA.body.data);
  });
});

describe('#108 · X2, X3 · Lo que no se ve en /inventory tampoco se recomienda', () => {
  it('el dominio lleva vendible, almacenable y compañía, con y sin soloDisponibles', () => {
    // Unitario a propósito: hoy ningún producto tiene compañía y todos los de
    // CONSUMIBLES son vendibles, así que contra Odoo ninguno de los dos filtros
    // se puede ver fallar. Es el mismo criterio que `inventarioUnidad.test.ts`.
    for (const solo of [false, true]) {
      const d = dominioCompatibles([1, 2], 9, solo);
      expect(d).toContainEqual(['product_tmpl_id', 'in', [1, 2]]);
      expect(d).toContainEqual(['sale_ok', '=', true]);
      expect(d).toContainEqual(['detailed_type', '=', 'product']);
      expect(d).toContainEqual(['company_id', 'in', [false, 9]]);
    }
    expect(dominioCompatibles([1], 9, true)).toContainEqual(['free_qty', '>', 0]);
    expect(dominioCompatibles([1], 9, false)).not.toContainEqual(['free_qty', '>', 0]);
  });
});

describe('#108 · X4 · Un cliente sin almacén', () => {
  it('recibe el 409 INVENTORY_UNAVAILABLE, no una lista entera en "agotado"', async () => {
    const r = await get<unknown>(`/recommender/printers/${impresora}/compatible`, keySinAlmacen);
    expect(r.status).toBe(409);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('INVENTORY_UNAVAILABLE');
  });
});

describe('#108 · X9 · limit', () => {
  it('limit acota las coincidencias', async () => {
    const todas = await get<PublicPrinterSearchResponse>('/recommender/printers?q=zzais77', A.key);
    expect(todas.body.data.length).toBe(3);
    const una = await get<PublicPrinterSearchResponse>('/recommender/printers?q=zzais77&limit=1', A.key);
    expect(una.body.data.length).toBe(1);
  });
});
