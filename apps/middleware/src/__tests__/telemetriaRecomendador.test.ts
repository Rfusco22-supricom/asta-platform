import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema, publicPrinterSearchResponseSchema, type PublicCompatibleResponse, type PublicPrinterSearchResponse } from '@asta/shared-types';
import { createApp } from '../server.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { vaciarCachesInventario } from '../services/inventory.service.js';
import { normalizarModelo } from '../services/recomendador/normalizar.js';
import { vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * #43 · Telemetría del recomendador, contra servidor, MySQL y Odoo reales.
 *
 * Lo que se vigila:
 *
 *   · cada búsqueda deja su fila con el texto CRUDO, también las que no
 *     encuentran nada (son las que enseñan qué alias faltan);
 *   · búsqueda → impresora elegida → producto pulsado es UNA fila;
 *   · el quiebre de venta (había producto compatible, ninguno en existencia) lo
 *     anota el servidor, contra la existencia real del almacén del cliente;
 *   · un cliente no puede tocar la fila de otro, ni reescribir una vieja.
 *
 * Datos `ZZ_TEL`, creados y borrados aquí. Los productos son reales, elegidos
 * por su existencia en `stock.quant`: uno con unidades y otro sin ninguna.
 */

const MARCA = 'ZZ_TEL_MARCA';
const CODIGOS = ['zztel1', 'zztel2'];

let server: Server;
let base = '';
let comprobado = false;
let idBitacoraInicial = 0n;
const usuarios: string[] = [];
const keys: string[] = [];

let A = { userId: '', key: '' };
let B = { userId: '', key: '' };
/** Impresora con un producto EN existencia; otra con uno SIN existencia; y dos que coinciden a la vez. */
const P = { conStock: 0, sinStock: 0, gemela1: 0, gemela2: 0 };
let productoConStock = 0;

async function pedir<T>(metodo: 'GET' | 'POST', ruta: string, key: string, cuerpo?: unknown) {
  const res = await fetch(`${base}/api/v1/public${ruta}`, {
    method: metodo,
    headers: { 'X-API-Key': key, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, body: (texto ? JSON.parse(texto) : null) as T };
}

const buscar = (q: string, key = A.key) => pedir<PublicPrinterSearchResponse>('GET', `/recommender/printers?q=${encodeURIComponent(q)}`, key);
const fila = (id: string | null) => prisma.recommendationEvent.findUniqueOrThrow({ where: { id: BigInt(id!) } });
const filasDe = (userId: string) => prisma.recommendationEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } });

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

beforeAll(async () => {
  const restos = (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.appUser.count({ where: { email: { endsWith: '@telemetria.local' } } }));
  if (restos) throw new Error(`Restos de ${MARCA} en la base: límpialos a mano.`);
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

  // Dos clientes reales de la compañía 10: `/compatible` resuelve su almacén en Odoo.
  const ocupados = new Set((await prisma.appUser.findMany({ select: { odooPartnerId: true } })).map((u) => u.odooPartnerId));
  const partners = (
    await searchRead<{ id: number }>('res.partner', [['company_id', '=', 10], ['customer_rank', '>', 0], ['parent_id', '=', false]], ['id'], { limit: 300, order: 'id' })
  ).filter((p) => !ocupados.has(p.id));
  if (partners.length < 2) throw new Error('Hacen falta dos clientes libres de la compañía 10.');
  const crear = async (partnerId: number, sufijo: string) => {
    const u = await prisma.appUser.create({
      data: { email: `test.tel.${sufijo}@telemetria.local`, fullName: `Telemetría ${sufijo}`, role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
    });
    usuarios.push(u.id);
    const k = await issueApiKey({ userId: u.id, name: `telemetría ${sufijo}`, scopes: ['RECOMMENDER_READ'], rateLimitPerMinute: 1000 });
    keys.push(k.id);
    return { userId: u.id, key: k.plaintext };
  };
  A = await crear(partners[0].id, 'a');
  B = await crear(partners[1].id, 'b');

  // Un producto con existencia holgada y otro sin ninguna en el almacén de la compañía 10.
  const almacen = await almacenSegunVentas(10);
  const candidatos = await searchRead<{ id: number; product_tmpl_id: [number, string] }>(
    'product.product',
    [['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['company_id', '=', false], ['categ_id', 'child_of', 2614]],
    ['product_tmpl_id'],
    { limit: 500, order: 'id desc' },
  );
  const libre = await libreSegunQuants(almacen, candidatos.map((c) => c.id));
  const con = candidatos.find((c) => (libre.get(c.id) ?? 0) > 20);
  const sin = candidatos.find((c) => (libre.get(c.id) ?? 0) <= 0);
  if (!con || !sin) throw new Error('Hace falta un consumible con existencia y otro sin ella: el test no probaría el quiebre.');
  productoConStock = con.id;

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const impresora = (name: string) => prisma.printerModel.create({ data: { brandId: marca.id, name, nameNormalized: normalizarModelo(name) } });
  const cartucho = (code: string) => prisma.cartridge.create({ data: { brandId: marca.id, code, codeNormalized: normalizarModelo(code), kind: 'TONER' } });
  const [pCon, pSin, g1, g2] = [await impresora('ZZ-Tel 5511'), await impresora('ZZ-Tel 5522'), await impresora('ZZ-Tel 5533a'), await impresora('ZZ-Tel 5533b')];
  Object.assign(P, { conStock: pCon.id, sinStock: pSin.id, gemela1: g1.id, gemela2: g2.id });
  const [cCon, cSin] = [await cartucho('ZZTEL1'), await cartucho('ZZTEL2')];
  await prisma.cartridgePrinterModel.createMany({
    data: [
      { cartridgeId: cCon.id, printerModelId: pCon.id, source: 'MANUAL', status: 'VALIDADA' },
      { cartridgeId: cSin.id, printerModelId: pSin.id, source: 'MANUAL', status: 'VALIDADA' },
      { cartridgeId: cCon.id, printerModelId: g1.id, source: 'MANUAL', status: 'VALIDADA' },
      { cartridgeId: cCon.id, printerModelId: g2.id, source: 'MANUAL', status: 'VALIDADA' },
    ],
  });
  await prisma.productCartridge.createMany({
    data: [
      { odooProductTmplId: con.product_tmpl_id[0], cartridgeId: cCon.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' },
      { odooProductTmplId: sin.product_tmpl_id[0], cartridgeId: cSin.id, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' },
    ],
  });
  vaciarCachesRecomendador();
  vaciarCachesInventario();
}, 180_000);

afterAll(async () => {
  if (comprobado) {
    // Antes que los usuarios: la FK pone user_id a NULL al borrarlos, y las filas
    // quedarían sin forma de saber que eran de este test.
    await prisma.recommendationEvent.deleteMany({ where: { userId: { in: usuarios } } });
    await prisma.cartridge.deleteMany({ where: { codeNormalized: { in: CODIGOS }, brand: { name: MARCA } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: keys } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#43 · Cada búsqueda deja su fila', () => {
  it('con el texto CRUDO, el usuario, los resultados y la impresora si solo hay una', async () => {
    const r = await buscar('  ZZ-Tel 5511 ');
    expect(r.status).toBe(200);
    expect(publicPrinterSearchResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.meta.busquedaId).toMatch(/^\d+$/);

    const f = await fila(r.body.meta.busquedaId);
    expect([f.searchQuery, f.userId, f.resultsCount, f.matchedPrinterId, f.clickedProductId, f.wasOutOfStock]).toEqual([
      '  ZZ-Tel 5511 ',
      A.userId,
      1,
      P.conStock,
      null,
      false,
    ]);
  });

  it('una búsqueda SIN resultados también: es la que enseña qué alias faltan', async () => {
    const r = await buscar('zztel impresora que no existe 9x9');
    expect(r.body.data).toEqual([]);
    const f = await fila(r.body.meta.busquedaId);
    expect([f.searchQuery, f.resultsCount, f.matchedPrinterId]).toEqual(['zztel impresora que no existe 9x9', 0, null]);
  });

  it('con varias coincidencias no se adivina la impresora', async () => {
    const r = await buscar('zztel5533');
    expect(r.body.data.map((p) => p.id).sort()).toEqual([P.gemela1, P.gemela2].sort());
    const f = await fila(r.body.meta.busquedaId);
    expect([f.resultsCount, f.matchedPrinterId]).toEqual([2, null]);
  });
});

describe('#43 · Búsqueda → impresora → producto es UNA fila', () => {
  it('elegir la impresora con busquedaId completa esa fila y no crea otra', async () => {
    const b = await buscar('zztel5533');
    const antes = (await filasDe(A.userId)).length;

    const c = await pedir<PublicCompatibleResponse>('GET', `/recommender/printers/${P.gemela2}/compatible?busquedaId=${b.body.meta.busquedaId}`, A.key);
    expect(c.status).toBe(200);
    expect((await filasDe(A.userId)).length).toBe(antes);
    const f = await fila(b.body.meta.busquedaId);
    expect([f.matchedPrinterId, f.wasOutOfStock]).toEqual([P.gemela2, false]);
  });

  it('el clic anota el producto en la misma fila', async () => {
    const b = await buscar('zztel5511');
    await pedir('GET', `/recommender/printers/${P.conStock}/compatible?busquedaId=${b.body.meta.busquedaId}`, A.key);
    const clic = await pedir('POST', `/recommender/busquedas/${b.body.meta.busquedaId}/clic`, A.key, { productId: productoConStock });
    expect(clic.status).toBe(204);
    const f = await fila(b.body.meta.busquedaId);
    expect([f.matchedPrinterId, f.clickedProductId, f.wasOutOfStock]).toEqual([P.conStock, productoConStock, false]);
  });

  it('sin busquedaId, la consulta queda en una fila propia con la consulta vacía', async () => {
    const antes = await filasDe(A.userId);
    await pedir('GET', `/recommender/printers/${P.conStock}/compatible`, A.key);
    const despues = await filasDe(A.userId);
    expect(despues.length).toBe(antes.length + 1);
    expect(despues.at(-1)).toMatchObject({ searchQuery: '', matchedPrinterId: P.conStock, resultsCount: 0 });
  });
});

describe('#43 · Quiebre de venta', () => {
  it('había producto compatible y ninguno en existencia → wasOutOfStock', async () => {
    const b = await buscar('zztel5522');
    const c = await pedir<PublicCompatibleResponse>('GET', `/recommender/printers/${P.sinStock}/compatible?busquedaId=${b.body.meta.busquedaId}`, A.key);
    expect(c.body.data.length).toBe(1);
    expect(c.body.data[0].stock).toBe('agotado');
    expect((await fila(b.body.meta.busquedaId)).wasOutOfStock).toBe(true);
  });

  it('con soloDisponibles no se afirma nada: los agotados no vienen', async () => {
    const b = await buscar('zztel5522');
    await pedir('GET', `/recommender/printers/${P.sinStock}/compatible?busquedaId=${b.body.meta.busquedaId}`, A.key);
    await pedir('GET', `/recommender/printers/${P.sinStock}/compatible?soloDisponibles=true&busquedaId=${b.body.meta.busquedaId}`, A.key);
    // Sigue el quiebre que se vio sin el filtro.
    expect((await fila(b.body.meta.busquedaId)).wasOutOfStock).toBe(true);
  });
});

describe('#43 · Nadie toca la fila de otro, ni una vieja', () => {
  it('B no puede completar la búsqueda de A: la de A no cambia y la de B va aparte', async () => {
    const deA = await buscar('zztel5533');
    await pedir('GET', `/recommender/printers/${P.gemela1}/compatible?busquedaId=${deA.body.meta.busquedaId}`, B.key);
    expect((await fila(deA.body.meta.busquedaId)).matchedPrinterId).toBeNull();
    expect((await filasDe(B.userId)).at(-1)).toMatchObject({ searchQuery: '', matchedPrinterId: P.gemela1 });
  });

  it('el clic sobre la búsqueda de otro es el mismo 404 que sobre una que no existe, y no escribe', async () => {
    const deA = await buscar('zztel5511');
    const ajena = await pedir<unknown>('POST', `/recommender/busquedas/${deA.body.meta.busquedaId}/clic`, B.key, { productId: productoConStock });
    const inexistente = await pedir<unknown>('POST', '/recommender/busquedas/999999999999/clic', B.key, { productId: productoConStock });
    expect([ajena.status, inexistente.status]).toEqual([404, 404]);
    expect(ajena.body).toEqual(inexistente.body);
    expect(apiErrorSchema.parse(ajena.body).error.code).toBe('SEARCH_NOT_FOUND');
    expect((await fila(deA.body.meta.busquedaId)).clickedProductId).toBeNull();
  });

  it('pasados 30 minutos la búsqueda ya no se completa', async () => {
    const b = await buscar('zztel5533');
    await prisma.recommendationEvent.update({ where: { id: BigInt(b.body.meta.busquedaId!) }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    await pedir('GET', `/recommender/printers/${P.gemela1}/compatible?busquedaId=${b.body.meta.busquedaId}`, A.key);
    const clic = await pedir('POST', `/recommender/busquedas/${b.body.meta.busquedaId}/clic`, A.key, { productId: productoConStock });
    expect(clic.status).toBe(404);
    const f = await fila(b.body.meta.busquedaId);
    expect([f.matchedPrinterId, f.clickedProductId]).toEqual([null, null]);
  });
});

describe('#43 · Entrada inválida', () => {
  it('busquedaId o productId mal formados → 400, sin escribir', async () => {
    const antes = (await filasDe(A.userId)).length;
    for (const [id, cuerpo] of [
      ['abc', { productId: 1 }],
      ['0', { productId: 1 }],
      ['12345678901234567890', { productId: 1 }],
      ['1', { productId: -1 }],
      ['1', {}],
    ] as const) {
      const r = await pedir<unknown>('POST', `/recommender/busquedas/${id}/clic`, A.key, cuerpo);
      expect(r.status, `${id} ${JSON.stringify(cuerpo)}`).toBe(400);
      expect(apiErrorSchema.safeParse(r.body).success).toBe(true);
    }
    const c = await pedir<unknown>('GET', `/recommender/printers/${P.conStock}/compatible?busquedaId=abc`, A.key);
    expect(c.status).toBe(400);
    expect((await filasDe(A.userId)).length).toBe(antes);
  });
});
