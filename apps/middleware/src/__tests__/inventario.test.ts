import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { executeKw, readGroup, searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { estadoDeStock, vaciarCachesInventario } from '../services/inventory.service.js';

/**
 * Issue #30 — `GET /api/v1/public/inventory`, contra el servidor, MySQL y Odoo
 * reales.
 *
 * Lo que se vigila no es que el endpoint responda, sino QUÉ existencia publica:
 *
 *   · la del almacén que vende a ese cliente, no la suma de 48 almacenes de
 *     6 compañías con "Mal Estado" y "Mercancía por Robo" incluidos
 *   · libre (menos lo reservado), no física
 *   · sin que la cache de 60 s le sirva a un cliente lo que vio otro
 *   · sin costos ni precios
 *
 * ── Por qué se contrasta por otra vía ────────────────────────────────────────
 *
 * El servicio pide `free_qty` con `context: { warehouse }`. Si el test pidiera lo
 * mismo, compararía Odoo consigo mismo. Aquí:
 *
 *   · el almacén de cada compañía sale de dónde se han despachado sus VENTAS
 *     (`sale.order.warehouse_id`), no del "primer almacén" que usa el servicio
 *   · la existencia libre se suma a mano desde `stock.quant`
 *
 * Si las dos vías coinciden, el servicio está bien.
 */

let server: Server;
let base = '';
let idBitacoraInicial = 0n;
const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];

interface Cliente {
  partnerId: number;
  companyId: number;
  /** Almacén según las ventas de su compañía. */
  warehouseId: number;
  key: string;
}

let A: Cliente;
let B: Cliente;
let keySinCompania = '';
let keySinScope = '';

type Item = Record<string, unknown> & { id: number; sku: string | null; stock: string };

async function get(path: string, key?: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: key ? { 'X-API-Key': key } : {} });
  const texto = await res.text();
  const body = JSON.parse(texto || 'null') as {
    data?: Item[];
    meta?: { total: number; pagina: number; porPagina: number; desdeCache: boolean };
    error?: { code?: string };
  } | null;
  return { status: res.status, body, texto };
}

async function crearUsuarioConKey(partnerId: number, sufijo: string, scopes: Array<'INVENTORY_READ' | 'PRICING_READ'> = ['INVENTORY_READ']) {
  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (usuario && !['BRONCE', 'PLATA', 'GOLD'].includes(usuario.role)) {
    throw new Error(`El partner ${partnerId} ya pertenece a un usuario con rol ${usuario.role}.`);
  }
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: {
        email: `test.inventario.${sufijo}@inventario.local`,
        fullName: `Cliente inventario ${sufijo}`,
        role: 'BRONCE',
        odooPartnerId: partnerId,
        isActive: true,
      },
    });
    usuariosCreados.push(usuario.id);
  }
  const k = await issueApiKey({ userId: usuario.id, name: `inventario ${sufijo}`, scopes, rateLimitPerMinute: 1000 });
  keysCreadas.push(k.id);
  return { userId: usuario.id, key: k.plaintext };
}

/**
 * El almacén de una compañía según sus ventas confirmadas: el que más pedidos ha
 * despachado. Lanza si no es prácticamente el único, porque entonces la premisa
 * de #30 —cada compañía vende desde un almacén— ya no se cumple y hay que
 * revisar la decisión, no el test.
 */
async function almacenSegunVentas(companyId: number): Promise<number> {
  const grupos = await readGroup<{ warehouse_id: [number, string] | false; __count: number }>(
    'sale.order',
    [['company_id', '=', companyId], ['state', 'in', ['sale', 'done']]],
    [],
    ['warehouse_id'],
  );
  const total = grupos.reduce((s, g) => s + g.__count, 0);
  const [mayor] = grupos.filter((g) => g.warehouse_id).sort((a, b) => b.__count - a.__count);
  if (!mayor || !mayor.warehouse_id || mayor.__count / total < 0.99) {
    throw new Error(`La compañía ${companyId} ya no vende desde un único almacén: revisar la decisión de #30.`);
  }
  return mayor.warehouse_id[0];
}

/** Existencia libre por producto en un almacén, sumada a mano desde `stock.quant`. */
async function libreSegunQuants(warehouseId: number, productIds: number[]): Promise<Map<number, number>> {
  const [wh] = await searchRead<{ view_location_id: [number, string] }>(
    'stock.warehouse',
    [['id', '=', warehouseId]],
    ['view_location_id'],
  );
  const quants = await searchRead<{ product_id: [number, string]; quantity: number; reserved_quantity: number }>(
    'stock.quant',
    [
      ['product_id', 'in', productIds],
      ['location_id', 'child_of', wh.view_location_id[0]],
      ['location_id.usage', '=', 'internal'],
    ],
    ['product_id', 'quantity', 'reserved_quantity'],
  );
  const libre = new Map<number, number>(productIds.map((id) => [id, 0]));
  for (const q of quants) libre.set(q.product_id[0], (libre.get(q.product_id[0]) ?? 0) + q.quantity - q.reserved_quantity);
  return libre;
}

/** Un cliente raíz de la compañía, con ventas, sin usuario de otro rol en MySQL. */
async function clienteDe(companyId: number): Promise<number> {
  const grupos = await readGroup<{ partner_id: [number, string] | false; __count: number }>(
    'sale.order',
    [['company_id', '=', companyId], ['state', 'in', ['sale', 'done']]],
    [],
    ['partner_id'],
    { limit: 40, orderby: '__count desc' },
  );
  const ids = grupos.filter((g) => g.partner_id).map((g) => (g.partner_id as [number, string])[0]);
  const partners = await searchRead<{ id: number; commercial_partner_id: [number, string] | false; company_id: [number, string] | false }>(
    'res.partner',
    [['id', 'in', ids]],
    ['commercial_partner_id', 'company_id'],
  );
  const ocupados = new Set(
    (await prisma.appUser.findMany({ where: { odooPartnerId: { in: ids }, role: { notIn: ['BRONCE', 'PLATA', 'GOLD'] } } })).map((u) => u.odooPartnerId),
  );
  const elegido = partners.find(
    (p) => (!p.commercial_partner_id || p.commercial_partner_id[0] === p.id) && p.company_id && p.company_id[0] === companyId && !ocupados.has(p.id),
  );
  if (!elegido) throw new Error(`No hay un cliente raíz utilizable en la compañía ${companyId}.`);
  return elegido.id;
}

/** Las dos compañías que más venden, para que A y B tengan almacenes distintos. */
async function dosCompanias(): Promise<[number, number]> {
  const grupos = await readGroup<{ company_id: [number, string] | false; __count: number }>(
    'sale.order',
    [['state', 'in', ['sale', 'done']]],
    [],
    ['company_id'],
  );
  const ids = grupos.filter((g) => g.company_id).sort((a, b) => b.__count - a.__count).map((g) => (g.company_id as [number, string])[0]);
  if (ids.length < 2) throw new Error('Hacen falta dos compañías con ventas.');
  return [ids[0], ids[1]];
}

/**
 * Un SKU con existencia libre holgada en el almacén de `con` y ninguna en el de
 * `sin`. Es el caso que delata una cache sin almacén en la clave, o un almacén
 * mal resuelto.
 */
async function skuQueSoloTiene(con: Cliente, sin: Cliente): Promise<{ id: number; sku: string }> {
  const candidatos = await searchRead<{ id: number; default_code: string | false }>(
    'product.product',
    [['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['default_code', '!=', false]],
    ['default_code'],
    { limit: 400, order: 'id desc' },
  );
  const ids = candidatos.map((c) => c.id);
  const [libreCon, libreSin] = await Promise.all([libreSegunQuants(con.warehouseId, ids), libreSegunQuants(sin.warehouseId, ids)]);
  const sku = candidatos.find((c) => (libreCon.get(c.id) ?? 0) > 20 && (libreSin.get(c.id) ?? 0) <= 0);
  if (!sku || !sku.default_code) throw new Error(`No hay un SKU con stock solo en el almacén ${con.warehouseId}: el test no probaría nada.`);
  // SKU único: si estuviera repetido, `?sku=` devolvería dos productos.
  const repetidos = await executeKw<number>('product.product', 'search_count', [[['default_code', '=', sku.default_code]]]);
  if (repetidos !== 1) throw new Error(`El SKU ${sku.default_code} está repetido.`);
  return { id: sku.id, sku: sku.default_code };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;
  vaciarCachesInventario();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  const [cA, cB] = await dosCompanias();
  const [pA, pB, wA, wB] = await Promise.all([clienteDe(cA), clienteDe(cB), almacenSegunVentas(cA), almacenSegunVentas(cB)]);
  if (wA === wB) throw new Error('Las dos compañías venden desde el mismo almacén: el test no probaría el aislamiento.');
  A = { partnerId: pA, companyId: cA, warehouseId: wA, key: (await crearUsuarioConKey(pA, 'a')).key };
  B = { partnerId: pB, companyId: cB, warehouseId: wB, key: (await crearUsuarioConKey(pB, 'b')).key };

  const [sinCompania] = await searchRead<{ id: number }>(
    'res.partner',
    [['customer_rank', '>', 0], ['company_id', '=', false], ['parent_id', '=', false]],
    ['id'],
    { limit: 1 },
  );
  if (!sinCompania) throw new Error('No hay clientes sin compañía: el caso del 409 queda SIN PROBAR.');
  keySinCompania = (await crearUsuarioConKey(sinCompania.id, 'sin-compania')).key;
  keySinScope = (await crearUsuarioConKey(pA, 'a', ['PRICING_READ'])).key;
}, 120_000);

afterAll(async () => {
  await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#30 · Qué existencia se publica', () => {
  it('cada estado de una página entera coincide con los quants del almacén del cliente', async () => {
    const r = await get('/inventory?porPagina=100', A.key);
    expect(r.status).toBe(200);
    const items = r.body?.data ?? [];
    expect(items.length).toBe(100);

    const libre = await libreSegunQuants(A.warehouseId, items.map((i) => i.id));
    const distintos = items
      .filter((i) => i.stock !== estadoDeStock(libre.get(i.id) ?? 0))
      .map((i) => ({ sku: i.sku, api: i.stock, quants: libre.get(i.id) }));
    expect(distintos).toEqual([]);
    // Una página donde todo está agotado no probaría nada.
    expect(new Set(items.map((i) => i.stock)).size).toBeGreaterThan(1);
  });

  it('un producto con unidades solo en OTRO almacén sale agotado', async () => {
    const soloEnB = await skuQueSoloTiene(B, A);
    const r = await get(`/inventory?sku=${encodeURIComponent(soloEnB.sku)}`, A.key);
    expect(r.status).toBe(200);
    expect(r.body?.data).toEqual([expect.objectContaining({ id: soloEnB.id, stock: 'agotado' })]);
  });

  it('las unidades reservadas no cuentan como disponibles', async () => {
    // Un producto con TODO lo físico comprometido: con qty_available saldría
    // disponible.
    const quants = await searchRead<{ product_id: [number, string]; quantity: number; reserved_quantity: number }>(
      'stock.quant',
      [['warehouse_id', '=', A.warehouseId], ['reserved_quantity', '>', 0], ['location_id.usage', '=', 'internal']],
      ['product_id', 'quantity', 'reserved_quantity'],
      { limit: 500 },
    );
    const ids = [...new Set(quants.map((q) => q.product_id[0]))];
    const libre = await libreSegunQuants(A.warehouseId, ids);
    const productos = await searchRead<{ id: number; default_code: string | false; qty_available: number }>(
      'product.product',
      [['id', 'in', ids], ['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['default_code', '!=', false]],
      ['default_code', 'qty_available'],
      { context: { warehouse: A.warehouseId, allowed_company_ids: [A.companyId] } },
    );
    const comprometido = productos.find((p) => p.qty_available > 0 && (libre.get(p.id) ?? 0) <= 0);
    if (!comprometido || !comprometido.default_code) {
      throw new Error(`No hay productos con todo lo físico reservado en el almacén ${A.warehouseId}: el caso queda SIN PROBAR.`);
    }
    const r = await get(`/inventory?sku=${encodeURIComponent(comprometido.default_code)}`, A.key);
    expect(r.body?.data?.[0]?.stock).toBe('agotado');
  });
});

describe('#30 · La cache no cruza clientes', () => {
  it('la MISMA consulta, con dos keys seguidas, da la existencia de cada almacén', async () => {
    // Si el almacén no fuera parte de la clave de cache, la segunda key recibiría
    // la respuesta de la primera durante 60 s.
    const soloEnA = await skuQueSoloTiene(A, B);
    const consulta = `/inventory?sku=${encodeURIComponent(soloEnA.sku)}`;

    const deA = await get(consulta, A.key);
    const deB = await get(consulta, B.key);

    expect(deA.body?.data?.[0]?.stock).not.toBe('agotado');
    expect(deB.body?.data?.[0]?.stock).toBe('agotado');
    expect(deB.body?.meta?.desdeCache).toBe(false);

    // Y la cache sí sirve dentro del mismo almacén.
    const deAOtraVez = await get(consulta, A.key);
    expect(deAOtraVez.body?.meta?.desdeCache).toBe(true);
    expect(deAOtraVez.body?.data).toEqual(deA.body?.data);
  });
});

describe('#30 · Qué NO sale nunca', () => {
  it('cada producto lleva exactamente los campos del contrato: sin costos ni precios', async () => {
    const r = await get('/inventory?porPagina=100', A.key);
    for (const item of r.body?.data ?? []) {
      expect(Object.keys(item).sort()).toEqual(['categoria', 'id', 'nombre', 'sku', 'stock', 'templateId']);
    }
    for (const campo of ['standard_price', 'list_price', 'lst_price', 'costo_reposicion_usd', 'company_sale_price', 'precio', 'free_qty', 'qty_available']) {
      expect(r.texto).not.toContain(campo);
    }
  });

  it('servicios, consumibles y productos no vendibles no aparecen', async () => {
    const [servicio] = await searchRead<{ default_code: string | false }>(
      'product.product',
      [['sale_ok', '=', true], ['detailed_type', '!=', 'product'], ['default_code', '!=', false]],
      ['default_code'],
      { limit: 1 },
    );
    if (!servicio?.default_code) throw new Error('No hay productos no almacenables con SKU: el caso queda SIN PROBAR.');
    const r = await get(`/inventory?sku=${encodeURIComponent(servicio.default_code)}`, A.key);
    expect(r.status).toBe(200);
    expect(r.body?.data).toEqual([]);
  });
});

describe('#30 · Filtros y paginación', () => {
  it('el total coincide con Odoo contado por separado', async () => {
    const esperado = await executeKw<number>('product.product', 'search_count', [
      [['sale_ok', '=', true], ['detailed_type', '=', 'product']],
    ]);
    const r = await get('/inventory?porPagina=1', A.key);
    expect(r.body?.meta?.total).toBe(esperado);
  });

  it('?soloDisponibles=false NO filtra (z.coerce.boolean lo leía como true)', async () => {
    const sinFiltro = await get('/inventory?porPagina=1', A.key);
    const conFalse = await get('/inventory?porPagina=1&soloDisponibles=false', A.key);
    const conTrue = await get('/inventory?porPagina=100&soloDisponibles=true', A.key);
    expect(conFalse.body?.meta?.total).toBe(sinFiltro.body?.meta?.total);
    expect(conTrue.body?.meta?.total).toBeLessThan(sinFiltro.body?.meta?.total ?? 0);
    expect((conTrue.body?.data ?? []).filter((i) => i.stock === 'agotado')).toEqual([]);
  });

  it('las páginas no se solapan', async () => {
    const p1 = await get('/inventory?porPagina=50&pagina=1', A.key);
    const p2 = await get('/inventory?porPagina=50&pagina=2', A.key);
    const ids1 = new Set((p1.body?.data ?? []).map((i) => i.id));
    expect((p2.body?.data ?? []).filter((i) => ids1.has(i.id))).toEqual([]);
    expect(p2.body?.data?.length).toBe(50);
  });

  it('?q busca en nombre y referencia', async () => {
    const r = await get('/inventory?q=toner&porPagina=100', A.key);
    expect(r.status).toBe(200);
    expect(r.body?.data?.length).toBeGreaterThan(0);
    for (const i of r.body?.data ?? []) {
      expect(`${i.nombre} ${i.sku}`.toLowerCase()).toContain('toner');
    }
  });
});

describe('#30 · Rechazos', () => {
  it('printerId → 400, no el catálogo entero', async () => {
    const r = await get('/inventory?printerId=5', A.key);
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('INVALID_QUERY');
  });

  it('un cliente sin compañía → 409, no un catálogo "agotado"', async () => {
    const r = await get('/inventory', keySinCompania);
    expect(r.status).toBe(409);
    expect(r.body?.error?.code).toBe('INVENTORY_UNAVAILABLE');
    expect(r.body?.data).toBeUndefined();
  });

  it('sin el scope INVENTORY_READ → 403', async () => {
    expect((await get('/inventory', keySinScope)).status).toBe(403);
  });

  it('con el partner_id de otro cliente → 400', async () => {
    expect((await get(`/inventory?partner_id=${B.partnerId}`, A.key)).status).toBe(400);
  });

  it('porPagina fuera de rango → 400', async () => {
    expect((await get('/inventory?porPagina=101', A.key)).status).toBe(400);
  });
});
