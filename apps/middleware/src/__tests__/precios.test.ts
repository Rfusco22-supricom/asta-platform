import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { publicPricingResponseSchema, type PublicPrice } from '@asta/shared-types';
import { createApp } from '../server.js';
import { executeKw, searchRead } from '../odoo/client.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import {
  invalidarPreciosDeProductos,
  invalidarPreciosDeTarifas,
  invalidarTarifasDeClientes,
  reglaAplicable,
  vaciarCachesPrecios,
  validarTarifa,
  type Regla,
} from '../services/pricing.service.js';

/**
 * #31 — `GET /api/v1/public/pricing`, con el gate de aislamiento heredado de #36.
 *
 * Contra Odoo real y MySQL real, como `publicIsolation.test.ts`. Solo lee de
 * Odoo: el oráculo es `sale.order.onchange`, que calcula un pedido SIN
 * guardarlo.
 *
 * ── El oráculo ───────────────────────────────────────────────────────────────
 *
 * El endpoint lee reglas de tarifa. Contrastarlo contra esas mismas reglas
 * sería comprobar que el código se da la razón a sí mismo. Aquí se contrasta
 * contra el precio que el propio Odoo pondría en un pedido del cliente
 * (`price_unit` de la línea), y a Odoo NO se le dice la tarifa: la resuelve él
 * desde el partner y la compañía. Así se prueban a la vez el precio y de qué
 * tarifa sale.
 *
 * ── Los dos clientes ─────────────────────────────────────────────────────────
 *
 * El «test crítico» de #31 pedía dos clientes de tiers distintos, y se creía
 * que no existían (#5). Existen: cada compañía tiene su tarifa, y lo que no
 * existía era la lectura correcta (ver `tarifas.service.ts`). A es de
 * Supricom, S.A (compañía 7) y B de SUPRICOM CCS 21 - B (compañía 10).
 *
 * Nada se salta si faltan datos: se LANZA. Un test que pasa sin probar nada es
 * el fallo que la revisión de #25 encontró en tres tests de aquel gate.
 */

const INICIO = new Date(Date.now() - 1000);
const COMPANIA_A = 7;
const COMPANIA_B = 10;

let server: Server;
let base = '';
const auditados: AuditEvent[] = [];
let quitarSink: () => void;

interface Cliente {
  partnerId: number;
  companyId: number;
  /** La tarifa según Odoo, resuelta por el oráculo. */
  pricelistId: number;
  userId: string;
  key: string;
  keyId: string;
}

let A: Cliente;
let B: Cliente;
/** Cliente sin compañía: no tiene una tarifa definida. */
let sinCompania: Cliente;
let keySinScope = '';

/** Referencias con precio real y DISTINTO en la tarifa de A y en la de B. */
let skusDistintos: string[] = [];
/** Referencias que existen pero no tienen precio publicable en la tarifa de A. */
let skusSinPrecioA: string[] = [];
/** Una tarifa archivada, para intentar colarla. */
let tarifaArchivada = 0;

const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];
/** Usuarios que ya existían y a los que se les cambia la tarifa copiada. */
const tarifaOriginal = new Map<string, { id: number | null; nombre: string | null }>();

async function get(path: string, key?: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: key ? { 'X-API-Key': key } : {} });
  const body = (await res.json().catch(() => null)) as {
    data?: PublicPrice[];
    meta?: { moneda: string; desdeCache: boolean };
    error?: { code?: string };
  } | null;
  return { status: res.status, body };
}

const precios = (skus: string[], key: string) => get(`/pricing?skus=${skus.map(encodeURIComponent).join(',')}`, key);

interface LineaOraculo {
  product_id: number;
  price_unit: number;
  pricelist_item_id: number | false;
}

/**
 * Lo que Odoo pondría en un pedido de `partnerId` en `companyId`, sin guardarlo.
 *
 * En dos pasos, y la tarifa la pone Odoo en los dos:
 *
 *   1. Un pedido vacío del cliente: Odoo le asigna su tarifa (`pricelist_id`).
 *   2. Ese pedido con una línea por producto: Odoo calcula `price_unit`.
 *
 * En un solo paso no sirve: sin `pricelist_id` en los valores, Odoo calcula las
 * líneas ANTES de resolver la tarifa y todas salen a 0 sin regla. Medido: la
 * regla 85809 (31.25) existía y el pedido de un solo paso daba 0.
 */
async function segunOdoo(partnerId: number, companyId: number, productIds: number[]) {
  type Respuesta = { value: { pricelist_id?: number | false; order_line?: Array<[number, number, LineaOraculo]> } };
  const spec = { partner_id: {}, company_id: {}, pricelist_id: {}, order_line: { fields: { product_id: {}, price_unit: {}, pricelist_item_id: {} } } };
  const context = { allowed_company_ids: [companyId] };

  const vacio = await executeKw<Respuesta>('sale.order', 'onchange', [[], { partner_id: partnerId, company_id: companyId }, [], spec], { context });
  const pricelistId = vacio.value.pricelist_id || null;
  if (!pricelistId || productIds.length === 0) return { pricelistId, porProducto: new Map<number, LineaOraculo>() };

  const conLineas = await executeKw<Respuesta>(
    'sale.order',
    'onchange',
    [
      [],
      {
        partner_id: partnerId,
        company_id: companyId,
        pricelist_id: pricelistId,
        order_line: productIds.map((id) => [0, 0, { product_id: id, product_uom_qty: 1 }]),
      },
      [],
      spec,
    ],
    { context },
  );
  return {
    pricelistId,
    porProducto: new Map((conLineas.value.order_line ?? []).map(([, , l]) => [l.product_id, l])),
  };
}

/** Un cliente raíz de la compañía, que no sea staff. */
async function clienteDe(companyId: number | false, excluir: Set<number>): Promise<number> {
  const candidatos = await searchRead<{ id: number }>(
    'res.partner',
    [['customer_rank', '>', 0], ['parent_id', '=', false], ['company_id', '=', companyId]],
    ['id'],
    { limit: 50, order: 'customer_rank desc, id' },
  );
  const id = candidatos.map((c) => c.id).find((c) => !excluir.has(c));
  if (!id) throw new Error(`No hay un cliente raíz libre en la compañía ${companyId}: el test no probaría nada.`);
  return id;
}

async function prepararCliente(partnerId: number, companyId: number, sufijo: string): Promise<Cliente> {
  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (usuario && !['BRONCE', 'PLATA', 'GOLD'].includes(usuario.role)) {
    throw new Error(`El partner ${partnerId} ya pertenece a un usuario con rol ${usuario.role}.`);
  }
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: { email: `test.precios.${sufijo}@precios.local`, fullName: `Cliente precios ${sufijo}`, role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  } else {
    tarifaOriginal.set(usuario.id, { id: usuario.odooPricelistId, nombre: usuario.odooPricelistName });
  }
  const emitida = await issueApiKey({ userId: usuario.id, name: `precios ${sufijo}`, scopes: ['PRICING_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(emitida.id);

  const { pricelistId } = companyId ? await segunOdoo(partnerId, companyId, []) : { pricelistId: null };
  return { partnerId, companyId, pricelistId: pricelistId ?? 0, userId: usuario.id, key: emitida.plaintext, keyId: emitida.id };
}

/** Reglas fijas por plantilla de una tarifa: `templateId → precio`. */
async function preciosFijos(pricelistId: number): Promise<Map<number, number>> {
  const reglas = await searchRead<{ product_tmpl_id: [number, string]; fixed_price: number }>(
    'product.pricelist.item',
    [['pricelist_id', '=', pricelistId], ['applied_on', '=', '1_product'], ['compute_price', '=', 'fixed']],
    ['product_tmpl_id', 'fixed_price'],
  );
  return new Map(reglas.map((r) => [r.product_tmpl_id[0], r.fixed_price]));
}

/** Referencias de productos a la venta, `templateId → sku`, sin las repetidas. */
async function skusPorPlantilla(): Promise<Map<number, string>> {
  const productos = await searchRead<{ default_code: string | false; product_tmpl_id: [number, string] }>(
    'product.product',
    [['sale_ok', '=', true], ['default_code', '!=', false]],
    ['default_code', 'product_tmpl_id'],
  );
  const cuenta = new Map<string, number>();
  for (const p of productos) cuenta.set(String(p.default_code), (cuenta.get(String(p.default_code)) ?? 0) + 1);
  return new Map(
    productos.filter((p) => cuenta.get(String(p.default_code)) === 1).map((p) => [p.product_tmpl_id[0], String(p.default_code)]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  quitarSink = registerAuditSink((e) => auditados.push(e));

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  vaciarCachesPrecios();

  const staff = new Set(
    (await prisma.appUser.findMany({ where: { role: { notIn: ['BRONCE', 'PLATA', 'GOLD'] } }, select: { odooPartnerId: true } })).map((u) => u.odooPartnerId),
  );
  A = await prepararCliente(await clienteDe(COMPANIA_A, staff), COMPANIA_A, 'a');
  B = await prepararCliente(await clienteDe(COMPANIA_B, staff), COMPANIA_B, 'b');
  if (!A.pricelistId || !B.pricelistId || A.pricelistId === B.pricelistId) {
    throw new Error(`A y B tienen que estar en tarifas distintas según Odoo (A=${A.pricelistId}, B=${B.pricelistId}).`);
  }
  const [pSin] = await searchRead<{ id: number }>('res.partner', [['customer_rank', '>', 0], ['parent_id', '=', false], ['company_id', '=', false]], ['id'], { limit: 1 });
  if (!pSin) throw new Error('No hay un cliente sin compañía: el 409 queda SIN PROBAR.');
  sinCompania = await prepararCliente(pSin.id, 0, 'sin');

  const sinScope = await issueApiKey({ userId: A.userId, name: 'precios sin scope', scopes: ['INVENTORY_READ'] });
  keysCreadas.push(sinScope.id);
  keySinScope = sinScope.plaintext;

  // ── Referencias ──────────────────────────────────────────────────────────
  // Con precio real y distinto en las dos tarifas. El 84 % de los productos
  // tiene algún 0.00 en las tarifas principales: dos ceros darían dos precios
  // «iguales» y el test pasaría sin probar nada.
  const [deA, deB, skus] = await Promise.all([preciosFijos(A.pricelistId), preciosFijos(B.pricelistId), skusPorPlantilla()]);
  skusDistintos = [...deA]
    .filter(([t, p]) => p > 0 && (deB.get(t) ?? 0) > 0 && deB.get(t) !== p && skus.has(t))
    .slice(0, 15)
    .map(([t]) => skus.get(t)!);
  if (skusDistintos.length < 5) throw new Error('No hay 5 referencias con precio distinto en las tarifas de A y B.');

  skusSinPrecioA = [...skus]
    .filter(([t]) => !deA.has(t) || deA.get(t) === 0)
    .slice(0, 10)
    .map(([, s]) => s);
  if (skusSinPrecioA.length < 3) throw new Error('No hay referencias sin precio en la tarifa de A: el caso «sin precio» queda SIN PROBAR.');

  const [archivada] = await searchRead<{ id: number }>('product.pricelist', [['active', '=', false]], ['id'], { limit: 1 });
  if (!archivada) throw new Error('No hay tarifas archivadas: el rechazo queda SIN PROBAR.');
  tarifaArchivada = archivada.id;
}, 180_000);

afterAll(async () => {
  quitarSink?.();
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  for (const [id, t] of tarifaOriginal) {
    await prisma.appUser.update({ where: { id }, data: { odooPricelistId: t.id, odooPricelistName: t.nombre } });
  }
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#31 · Cada cliente recibe el precio de SU tarifa, según Odoo', () => {
  it('la respuesta cumple el contrato, en el orden pedido y en la moneda de la tarifa', async () => {
    const pedidos = [...skusDistintos.slice(0, 3), 'NO-EXISTE-31'];
    const r = await precios(pedidos, A.key);
    expect(r.status).toBe(200);
    expect(publicPricingResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.body!.data!.map((p) => p.sku)).toEqual(pedidos);
    expect(r.body!.data![3]).toMatchObject({ productId: null, precio: null, motivo: 'sku_no_encontrado' });
    expect(r.body!.meta!.moneda).toBe('USD');
  });

  for (const cual of ['A', 'B'] as const) {
    it(`${cual}: cada precio coincide con el que Odoo pondría en su pedido`, async () => {
      // SKU a SKU. Un 400 bien puesto no demuestra que un 200 no esté sirviendo
      // el precio de otra lista.
      //
      // `toBeCloseTo` y no `toBe`: Odoo devuelve 42.050000000000004 donde la
      // regla dice 42.05 (arrastra la conversión de moneda). Cuatro decimales
      // bastan: un precio de otra tarifa difiere en céntimos como poco.
      const c = cual === 'A' ? A : B;
      const r = await precios(skusDistintos, c.key);
      expect(r.status).toBe(200);

      const oraculo = await segunOdoo(c.partnerId, c.companyId, r.body!.data!.map((p) => p.productId!));
      expect(oraculo.pricelistId).toBe(c.pricelistId);
      for (const p of r.body!.data!) {
        expect(p.motivo, p.sku).toBe('ok');
        expect(p.precio, p.sku).toBeCloseTo(oraculo.porProducto.get(p.productId!)!.price_unit, 4);
      }
    });
  }

  it('el mismo SKU da precios distintos a A y a B (el «test crítico» de #31)', async () => {
    const [ra, rb] = await Promise.all([precios(skusDistintos, A.key), precios(skusDistintos, B.key)]);
    const iguales = ra.body!.data!.filter((p, i) => p.precio === rb.body!.data![i].precio);
    expect(iguales).toEqual([]);
  });

  it('sin precio en la tarifa → precio null y motivo, nunca 0 ni el precio base', async () => {
    const r = await precios(skusSinPrecioA, A.key);
    expect(r.status).toBe(200);
    const oraculo = await segunOdoo(A.partnerId, A.companyId, r.body!.data!.map((p) => p.productId!));
    for (const p of r.body!.data!) {
      expect(p, p.sku).toMatchObject({ precio: null, motivo: 'sin_precio_en_tarifa' });
      // Y en Odoo, efectivamente, no hay regla que dé un precio: o no aplica
      // ninguna, o la que aplica vale 0.
      const l = oraculo.porProducto.get(p.productId!)!;
      expect(!l.pricelist_item_id || l.price_unit === 0, p.sku).toBe(true);
    }
  });

  it('una referencia repetida se cotiza una vez', async () => {
    const r = await precios([skusDistintos[0], skusDistintos[0]], A.key);
    expect(r.body!.data).toHaveLength(1);
  });
});

describe('#31 · La cache no cruza tarifas', () => {
  it('A y luego B, el mismo SKU seguido: B recibe el suyo', async () => {
    // Sin la tarifa en la clave, B recibiría durante 5 minutos el precio que
    // dejó A en la cache.
    vaciarCachesPrecios();
    const sku = skusDistintos[1];
    const ra = await precios([sku], A.key);
    const rb = await precios([sku], B.key);
    expect(ra.body!.data![0].precio).not.toBe(rb.body!.data![0].precio);

    const oraculo = await segunOdoo(B.partnerId, B.companyId, [rb.body!.data![0].productId!]);
    expect(rb.body!.data![0].precio).toBeCloseTo(oraculo.porProducto.get(rb.body!.data![0].productId!)!.price_unit, 4);
  });

  it('la segunda consulta sale de la cache y dice que sale de la cache', async () => {
    vaciarCachesPrecios();
    const sku = skusDistintos[2];
    const primera = await precios([sku], A.key);
    const segunda = await precios([sku], A.key);
    expect(primera.body!.meta!.desdeCache).toBe(false);
    expect(segunda.body!.meta!.desdeCache).toBe(true);
    expect(segunda.body!.data).toEqual(primera.body!.data);
  });
});

describe('#34 · Invalidación y métrica de acierto', () => {
  it('invalidar la tarifa de A no toca la cache de B', async () => {
    vaciarCachesPrecios();
    const sku = [skusDistintos[3]];
    await Promise.all([precios(sku, A.key), precios(sku, B.key)]);

    expect(invalidarPreciosDeTarifas(new Set([A.pricelistId]))).toBeGreaterThan(0);
    const [ra, rb] = await Promise.all([precios(sku, A.key), precios(sku, B.key)]);
    expect(ra.body!.meta!.desdeCache).toBe(false);
    expect(rb.body!.meta!.desdeCache).toBe(true);
  });

  it('invalidar un producto se lleva sus precios en todas las tarifas', async () => {
    vaciarCachesPrecios();
    const r = await precios([skusDistintos[4]], A.key);
    await precios([skusDistintos[4]], B.key);
    expect(invalidarPreciosDeProductos(new Set([r.body!.data![0].productId!]))).toBe(2);
  });

  it('invalidar un cliente vuelve a resolver su tarifa, y solo la suya', async () => {
    vaciarCachesPrecios();
    await Promise.all([precios(skusDistintos.slice(0, 1), A.key), precios(skusDistintos.slice(0, 1), B.key)]);
    expect(invalidarTarifasDeClientes(new Set([A.partnerId]))).toBe(1);
  });

  it('la bitácora marca cache_hit solo cuando la respuesta sale ENTERA de cache', async () => {
    vaciarCachesPrecios();
    const sku = skusDistintos[5];
    const desde = new Date();
    await precios([sku], A.key); // de Odoo
    await precios([sku], A.key); // de cache
    await precios([sku, skusDistintos[6]], A.key); // mitad y mitad: no es un acierto

    // Las filas se escriben al terminar cada respuesta, en diferido.
    await vi.waitFor(
      async () => {
        expect(await prisma.apiRequestLog.count({ where: { apiKeyId: A.keyId, createdAt: { gte: desde } } })).toBe(3);
      },
      { timeout: 10_000, interval: 200 },
    );
    const filas = await prisma.apiRequestLog.findMany({
      where: { apiKeyId: A.keyId, createdAt: { gte: desde } },
      orderBy: { createdAt: 'asc' },
      select: { cacheHit: true, odooCalls: true },
    });
    expect(filas.map((f) => f.cacheHit)).toEqual([false, true, false]);
    expect(filas[1].odooCalls).toBe(0);
  });
});

describe('#31 · Gate: nadie elige la tarifa', () => {
  const intentos = (b: () => Cliente) => [
    ['?pricelist=<B>', () => `pricelist=${b().pricelistId}`],
    ['?pricelist_id=<B>', () => `pricelist_id=${b().pricelistId}`],
    ['?pricelistId=<B>', () => `pricelistId=${b().pricelistId}`],
    ['?tarifa=<B>', () => `tarifa=${b().pricelistId}`],
    ['?context[pricelist]=<B>', () => `context[pricelist]=${b().pricelistId}`],
    ['?company_id=<compañía de B>', () => `company_id=${b().companyId}`],
    ['?allowed_company_ids=<compañía de B>', () => `allowed_company_ids=${b().companyId}`],
    ['?pricelist=<archivada>', () => `pricelist=${tarifaArchivada}`],
  ] as const;

  for (const [nombre, qs] of intentos(() => B)) {
    it(`key de A con ${nombre} → 400 PRICELIST_NOT_ALLOWED, sin precios, y auditado`, async () => {
      const antes = auditados.filter((e) => e.action === 'access.denied.pricelist').length;
      const r = await get(`/pricing?skus=${encodeURIComponent(skusDistintos[0])}&${qs()}`, A.key);
      expect(r.status).toBe(400);
      expect(r.body?.error?.code).toBe('PRICELIST_NOT_ALLOWED');
      expect(r.body?.data).toBeUndefined();

      const nuevos = auditados.filter((e) => e.action === 'access.denied.pricelist').slice(antes);
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]).toMatchObject({
        actorId: A.userId,
        targetType: 'product.pricelist',
        metadata: { via: 'api_key', apiKeyId: A.keyId, partnerDelToken: A.partnerId },
      });
    });
  }

  it('una consulta legítima NO genera evento de denegación', async () => {
    const antes = auditados.filter((e) => e.action.startsWith('access.denied')).length;
    await precios(skusDistintos.slice(0, 2), A.key);
    expect(auditados.filter((e) => e.action.startsWith('access.denied')).length).toBe(antes);
  });

  it('la tarifa copiada en app_users NO manda: aunque diga la de B, A recibe la suya', async () => {
    // La otra forma de «forzar» una tarifa: que el dato del middleware esté mal.
    // Hasta #31 lo estaba para dos tercios de los clientes.
    vaciarCachesPrecios();
    await prisma.appUser.update({ where: { id: A.userId }, data: { odooPricelistId: B.pricelistId } });
    try {
      const r = await precios(skusDistintos.slice(0, 5), A.key);
      const oraculo = await segunOdoo(A.partnerId, A.companyId, r.body!.data!.map((p) => p.productId!));
      for (const p of r.body!.data!) expect(p.precio, p.sku).toBeCloseTo(oraculo.porProducto.get(p.productId!)!.price_unit, 4);
    } finally {
      await prisma.appUser.update({ where: { id: A.userId }, data: { odooPricelistId: tarifaOriginal.get(A.userId)?.id ?? null } });
    }
  });

  it('una tarifa archivada no se acepta aunque llegue por dentro', async () => {
    const r = await validarTarifa(tarifaArchivada, A.companyId);
    expect(r.ok).toBe(false);
  });

  it('la tarifa de otra compañía no se acepta aunque llegue por dentro', async () => {
    const r = await validarTarifa(B.pricelistId, A.companyId);
    expect(r.ok).toBe(false);
  });

  it('un cliente sin compañía → 409 PRICELIST_UNAVAILABLE, no la tarifa de una compañía cualquiera', async () => {
    const r = await precios(skusDistintos.slice(0, 1), sinCompania.key);
    expect(r.status).toBe(409);
    expect(r.body?.error?.code).toBe('PRICELIST_UNAVAILABLE');
    expect(r.body?.data).toBeUndefined();
  });

  it('ningún punto del cálculo pasa `active_test: false`', () => {
    // Resucitaría las 7 tarifas archivadas y sus 16.546 reglas. Se mira el código,
    // sin comentarios: no hay otra forma de probar que un contexto NO se pasa.
    for (const f of ['../services/pricing.service.ts', '../services/tarifas.service.ts']) {
      const codigo = readFileSync(new URL(f, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(codigo, f).not.toMatch(/active_test/);
    }
  });
});

describe('#31 · Entrada', () => {
  it('sin API key → 401; sin PRICING_READ → 403', async () => {
    expect((await get('/pricing?skus=X')).status).toBe(401);
    const r = await get('/pricing?skus=X', keySinScope);
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('sin skus, vacío o con más de 100 → 400 INVALID_QUERY', async () => {
    for (const qs of ['', '?skus=', '?skus=,,', `?skus=${Array.from({ length: 101 }, (_, i) => `S${i}`).join(',')}`]) {
      const r = await get(`/pricing${qs}`, A.key);
      expect(r.status, qs).toBe(400);
      expect(r.body?.error?.code, qs).toBe('INVALID_QUERY');
    }
  });

  it('?partner_id de otro cliente → 400, como en el resto de la API', async () => {
    const r = await get(`/pricing?skus=X&partner_id=${B.partnerId}`, A.key);
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('PARTNER_ID_NOT_ALLOWED');
  });
});

describe('#31 · Qué regla gana (como Odoo)', () => {
  const producto = { id: 10, templateId: 20 };
  const regla = (r: Partial<Regla> & { id: number }): Regla => ({
    applied_on: '1_product',
    compute_price: 'fixed',
    fixed_price: 1,
    product_id: false,
    product_tmpl_id: [20, 'x'],
    min_quantity: 0,
    date_start: false,
    date_end: false,
    ...r,
  });

  it('la de variante gana a la de producto, aunque sea más antigua', () => {
    const r = reglaAplicable(producto, [regla({ id: 9 }), regla({ id: 1, applied_on: '0_product_variant', product_id: [10, 'x'] })]);
    expect(r?.id).toBe(1);
  });

  it('entre iguales gana la más reciente', () => {
    expect(reglaAplicable(producto, [regla({ id: 3 }), regla({ id: 7 }), regla({ id: 5 })])?.id).toBe(7);
  });

  it('min_quantity 1 gana a 0; mayor que 1 no aplica a una unidad', () => {
    expect(reglaAplicable(producto, [regla({ id: 9, min_quantity: 0 }), regla({ id: 1, min_quantity: 1 })])?.id).toBe(1);
    expect(reglaAplicable(producto, [regla({ id: 1, min_quantity: 5 })])).toBeUndefined();
  });

  it('una regla fuera de fechas no aplica', () => {
    const ahora = Date.parse('2026-09-24T12:00:00Z');
    expect(reglaAplicable(producto, [regla({ id: 1, date_end: '2026-09-01 00:00:00' })], ahora)).toBeUndefined();
    expect(reglaAplicable(producto, [regla({ id: 1, date_start: '2026-10-01 00:00:00' })], ahora)).toBeUndefined();
    expect(reglaAplicable(producto, [regla({ id: 1, date_start: '2026-09-01 00:00:00', date_end: '2026-10-01 00:00:00' })], ahora)?.id).toBe(1);
  });

  it('las reglas de otro producto no cuentan', () => {
    expect(reglaAplicable(producto, [regla({ id: 1, product_tmpl_id: [99, 'y'] }), regla({ id: 2, applied_on: '0_product_variant', product_id: [99, 'y'] })])).toBeUndefined();
  });
});
