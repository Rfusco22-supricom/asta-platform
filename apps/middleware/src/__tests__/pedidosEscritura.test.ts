import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { publicOrderDetailResponseSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { almacenDelCliente } from '../services/inventory.service.js';
import { leerTarifasConCompania } from '../services/tarifas.service.js';
import { vaciarCachesPrecios } from '../services/pricing.service.js';
import { huellaPedido, origenDe, usarEscritorPedidos, type PedidoParaOdoo } from '../services/pedidosEscritura.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * #33 — `POST /orders`, con la parte de ESCRITURA del gate heredado de #36.
 *
 * ── Sin escribir en Odoo ─────────────────────────────────────────────────────
 *
 * La creación del `sale.order` la hace un escritor SIMULADO: apunta qué le
 * pidieron y devuelve el id de un borrador que el cliente ya tiene en Odoo. Así
 * todo lo demás es real —la tarifa, los precios, la existencia del almacén, la
 * lectura del pedido devuelto— y no se crea nada en producción. Cuando exista
 * staging (#13), esta misma batería se corre con el escritor de verdad.
 *
 * Lo que el simulado NO prueba, y queda para staging: que Odoo acepte el
 * `create` tal como se manda, y que el precio que pone en la línea sea el de la
 * tarifa del cliente.
 */

const INICIO = new Date(Date.now() - 1000);

let server: Server;
let base = '';
const auditados: AuditEvent[] = [];
let quitarSink: () => void;
let restaurarEscritor: () => void;

/** Lo que recibió el escritor simulado, en orden. */
const pedidosAOdoo: PedidoParaOdoo[] = [];
/**
 * Cómo acaba el `create` simulado:
 *   no                 se crea y responde
 *   rechazo            Odoo dice que no (XML-RPC con faultCode): no se crea nada
 *   ambiguo-creado     se crea en Odoo, pero el middleware deja de esperar
 *                      (tiempo agotado local, conexión cortada)
 *   ambiguo-sin-crear  lo mismo, pero Odoo no llegó a crearlo
 */
let finalDelCreate: 'no' | 'rechazo' | 'ambiguo-creado' | 'ambiguo-sin-crear' = 'no';
/** Lo que «existe en Odoo»: `${partnerId}|${origin}` -> id. Lo lee `buscar`. */
const creadosEnOdoo = new Map<string, number>();
const tiempoAgotado = () => new Error('Odoo RPC timeout tras 30000 ms (execute_kw)');

interface Cliente {
  partnerId: number;
  companyId: number;
  pricelistId: number;
  warehouseId: number;
  userId: string;
  key: string;
  keyId: string;
  /** Un borrador suyo, NO creado por la API: lo que devuelve el escritor simulado. */
  borrador: number;
}

let A: Cliente;
let B: Cliente;
let keySoloLectura = '';
/** Con precio en la tarifa de A y existencia libre en su almacén. */
let skuConExistencia = '';
/** Con precio en la tarifa de A pero sin existencia libre. */
let skuAgotado = '';

const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];

async function post(cuerpo: unknown, key: string, clave?: string) {
  const res = await fetch(`${base}/api/v1/public/orders`, {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...(clave ? { 'Idempotency-Key': clave } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { id: number; estado: string; lineas: Array<{ sku: string | null; cantidad: number }> };
    error?: { code?: string; message?: string; detalles?: Array<{ sku: string; motivo: string }> };
  } | null;
  return { status: res.status, body, headers: res.headers };
}

async function get(path: string, key: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: { 'X-API-Key': key } });
  return { status: res.status, body: (await res.json().catch(() => null)) as { data?: unknown; error?: { code?: string } } | null };
}

let contador = 0;
const claveNueva = () => `prueba-33-${Date.now()}-${++contador}`;
const pedidoValido = () => ({ lineas: [{ sku: skuConExistencia, cantidad: 1 }], referenciaCliente: 'OC-PRUEBA-33' });

/** Un cliente raíz de la compañía, con algún borrador en Odoo, que no sea staff. */
async function clienteConBorrador(companyId: number, excluir: Set<number>): Promise<{ partnerId: number; borrador: number }> {
  const grupos = await readGroup<{ partner_id: [number, string] | false; __count: number }>(
    'sale.order',
    [['state', '=', 'draft'], ['company_id', '=', companyId], ['partner_id.parent_id', '=', false]],
    [],
    ['partner_id'],
  );
  for (const g of grupos) {
    if (!g.partner_id || excluir.has(g.partner_id[0])) continue;
    const [pedido] = await searchRead<{ id: number }>('sale.order', [['partner_id', '=', g.partner_id[0]], ['state', '=', 'draft']], ['id'], { limit: 1, order: 'id desc' });
    if (pedido) return { partnerId: g.partner_id[0], borrador: pedido.id };
  }
  throw new Error(`No hay un cliente raíz con borradores en la compañía ${companyId}: el test no probaría nada.`);
}

async function prepararCliente(companyId: number, excluir: Set<number>, sufijo: string): Promise<Cliente> {
  const { partnerId, borrador } = await clienteConBorrador(companyId, excluir);
  const tarifa = (await leerTarifasConCompania([partnerId])).get(partnerId);
  const almacen = await almacenDelCliente(partnerId);
  if (!tarifa?.tarifa || !almacen) throw new Error(`El cliente ${partnerId} no tiene tarifa o almacén.`);

  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (usuario && !['BRONCE', 'PLATA', 'GOLD'].includes(usuario.role)) throw new Error(`El partner ${partnerId} es staff.`);
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: { email: `test.pedidos.escritura.${sufijo}@pedidos.local`, fullName: `Cliente escritura ${sufijo}`, role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  }
  const k = await issueApiKey({ userId: usuario.id, name: `pedidos escritura ${sufijo}`, scopes: ['ORDERS_WRITE', 'ORDERS_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(k.id);
  return {
    partnerId,
    companyId,
    pricelistId: tarifa.tarifa[0],
    warehouseId: almacen.warehouseId,
    userId: usuario.id,
    key: k.plaintext,
    keyId: k.id,
    borrador,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.API_PEDIDOS_ESCRITURA = 'true';
  quitarSink = registerAuditSink((e) => auditados.push(e));
  restaurarEscritor = usarEscritorPedidos({
    async crear(p) {
      pedidosAOdoo.push(p);
      if (finalDelCreate === 'rechazo') throw Object.assign(new Error('Odoo rechazó el create (simulado)'), { faultCode: 2 });
      if (finalDelCreate === 'ambiguo-sin-crear') throw tiempoAgotado();
      const id = p.partnerId === A.partnerId ? A.borrador : B.borrador;
      creadosEnOdoo.set(`${p.partnerId}|${p.origen}`, id);
      if (finalDelCreate === 'ambiguo-creado') throw tiempoAgotado();
      return id;
    },
    async buscar(partnerId, origen) {
      return creadosEnOdoo.get(`${partnerId}|${origen}`) ?? null;
    },
  });

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  const staff = new Set(
    (await prisma.appUser.findMany({ where: { role: { notIn: ['BRONCE', 'PLATA', 'GOLD'] } }, select: { odooPartnerId: true } })).map((u) => u.odooPartnerId),
  );
  A = await prepararCliente(7, staff, 'a');
  B = await prepararCliente(10, new Set([...staff, A.partnerId]), 'b');

  const lectura = await issueApiKey({ userId: A.userId, name: 'pedidos solo lectura', scopes: ['ORDERS_READ'] });
  keysCreadas.push(lectura.id);
  keySoloLectura = lectura.plaintext;

  // Referencias de la tarifa de A, una con existencia libre y otra sin ella.
  const reglas = await searchRead<{ product_tmpl_id: [number, string] }>(
    'product.pricelist.item',
    [['pricelist_id', '=', A.pricelistId], ['applied_on', '=', '1_product'], ['compute_price', '=', 'fixed'], ['fixed_price', '>', 0]],
    ['product_tmpl_id'],
    { limit: 400, order: 'id desc' },
  );
  const productos = await searchRead<{ default_code: string | false; free_qty: number }>(
    'product.product',
    [['product_tmpl_id', 'in', reglas.map((r) => r.product_tmpl_id[0])], ['sale_ok', '=', true], ['default_code', '!=', false]],
    ['default_code', 'free_qty'],
    { context: { warehouse: A.warehouseId, allowed_company_ids: [A.companyId] } },
  );
  const repetidos = new Set(productos.map((p) => p.default_code).filter((c, i, t) => t.indexOf(c) !== i));
  const unicos = productos.filter((p) => !repetidos.has(p.default_code));
  skuConExistencia = String(unicos.find((p) => p.free_qty >= 2)?.default_code ?? '');
  skuAgotado = String(unicos.find((p) => p.free_qty <= 0)?.default_code ?? '');
  if (!skuConExistencia || !skuAgotado) throw new Error('Hacen falta una referencia con existencia y otra agotada en la tarifa de A.');
}, 180_000);

beforeEach(() => {
  finalDelCreate = 'no';
  delete process.env.API_PEDIDOS_MARGEN_CONCILIACION_S;
  vaciarCachesPrecios();
});

afterAll(async () => {
  delete process.env.API_PEDIDOS_ESCRITURA;
  quitarSink?.();
  restaurarEscritor?.();
  await esperarBitacora(INICIO);
  // Solo lo de SUS keys, no «todo desde que empecé»: los ficheros corren en
  // paralelo, y borrar por tiempo le quitaba a otro test (precios.test.ts, que
  // cuenta las filas de su key) las que estaba contando.
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, apiKeyId: { in: keysCreadas } } });
  await prisma.apiOrderRequest.deleteMany({ where: { createdAt: { gte: INICIO }, apiKeyId: { in: keysCreadas } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#33 · Interruptor y permisos', () => {
  it('con API_PEDIDOS_ESCRITURA apagado, POST /orders responde 501 y no escribe', async () => {
    delete process.env.API_PEDIDOS_ESCRITURA;
    const apagada = createApp();
    process.env.API_PEDIDOS_ESCRITURA = 'true';
    const s: Server = await new Promise((resolve) => {
      const x = apagada.listen(0, () => resolve(x));
    });
    try {
      const puerto = (s.address() as { port: number }).port;
      const antes = pedidosAOdoo.length;
      const r = await fetch(`http://127.0.0.1:${puerto}/api/v1/public/orders`, {
        method: 'POST',
        headers: { 'X-API-Key': A.key, 'Content-Type': 'application/json', 'Idempotency-Key': claveNueva() },
        body: JSON.stringify(pedidoValido()),
      });
      expect(r.status).toBe(501);
      expect(pedidosAOdoo.length).toBe(antes);
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it('una key sin ORDERS_WRITE → 403, aunque tenga ORDERS_READ', async () => {
    const r = await post(pedidoValido(), keySoloLectura, claveNueva());
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('sin Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED, sin escribir', async () => {
    const antes = pedidosAOdoo.length;
    const r = await post(pedidoValido(), A.key);
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(pedidosAOdoo.length).toBe(antes);
  });
});

describe('#33 · Gate: nadie elige cliente, tarifa ni precio', () => {
  it('POST con el partner_id de B → 400, sin escribir, y auditado', async () => {
    const antes = pedidosAOdoo.length;
    const auditAntes = auditados.filter((e) => e.action === 'access.denied.partner').length;
    const r = await post({ ...pedidoValido(), partner_id: B.partnerId }, A.key, claveNueva());
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('PARTNER_ID_NOT_ALLOWED');
    expect(pedidosAOdoo.length).toBe(antes);
    const nuevos = auditados.filter((e) => e.action === 'access.denied.partner').slice(auditAntes);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({ actorId: A.userId, targetId: String(B.partnerId) });
  });

  for (const [nombre, linea] of [
    ['price_unit', { price_unit: 0.01 }],
    ['precio', { precio: 1 }],
    ['discount', { discount: 99 }],
  ] as const) {
    it(`una línea con ${nombre} → 400 que explica que el precio sale de la tarifa, sin escribir`, async () => {
      const antes = pedidosAOdoo.length;
      const r = await post({ lineas: [{ sku: skuConExistencia, cantidad: 1, ...linea }] }, A.key, claveNueva());
      expect(r.status).toBe(400);
      expect(r.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(r.body?.error?.message).toMatch(/precio/i);
      expect(pedidosAOdoo.length).toBe(antes);
    });
  }

  it('una tarifa en el cuerpo → 400 PRICELIST_NOT_ALLOWED, auditado', async () => {
    const auditAntes = auditados.filter((e) => e.action === 'access.denied.pricelist').length;
    const r = await post({ ...pedidoValido(), pricelist_id: B.pricelistId }, A.key, claveNueva());
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('PRICELIST_NOT_ALLOWED');
    expect(auditados.filter((e) => e.action === 'access.denied.pricelist').length).toBe(auditAntes + 1);
  });

  it('sin partner_id: el pedido va a nombre de A, en SU compañía, SU tarifa y SU almacén, sin precio', async () => {
    const antes = pedidosAOdoo.length;
    const r = await post(pedidoValido(), A.key, claveNueva());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(pedidosAOdoo.length).toBe(antes + 1);
    const enviado = pedidosAOdoo[pedidosAOdoo.length - 1];
    // Contra lo que dice Odoo del cliente, no contra lo que calculó el endpoint.
    expect(enviado).toMatchObject({ partnerId: A.partnerId, companyId: A.companyId, pricelistId: A.pricelistId, warehouseId: A.warehouseId });
    for (const l of enviado.lineas) expect(Object.keys(l).sort()).toEqual(['cantidad', 'productId']);
  });
});

describe('#33 · Validación antes de escribir', () => {
  it('una referencia que no existe → 400 ORDER_LINES_INVALID con el detalle, sin escribir', async () => {
    const antes = pedidosAOdoo.length;
    const r = await post({ lineas: [{ sku: skuConExistencia, cantidad: 1 }, { sku: 'NO-EXISTE-33', cantidad: 1 }] }, A.key, claveNueva());
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('ORDER_LINES_INVALID');
    expect(r.body?.error?.detalles).toEqual([{ sku: 'NO-EXISTE-33', motivo: 'sku_no_encontrado' }]);
    expect(pedidosAOdoo.length).toBe(antes);
  });

  it('una referencia repetida → 400', async () => {
    const r = await post({ lineas: [{ sku: skuConExistencia, cantidad: 1 }, { sku: skuConExistencia, cantidad: 2 }] }, A.key, claveNueva());
    expect(r.status).toBe(400);
    expect(r.body?.error?.detalles).toEqual([{ sku: skuConExistencia, motivo: 'sku_repetido' }]);
  });

  it('sin existencia suficiente → 409 INSUFFICIENT_STOCK y no se crea NADA del pedido', async () => {
    // Decidido en #33: se rechaza entero, aunque otras líneas sí tengan existencia.
    const antes = pedidosAOdoo.length;
    const r = await post({ lineas: [{ sku: skuConExistencia, cantidad: 1 }, { sku: skuAgotado, cantidad: 1 }] }, A.key, claveNueva());
    expect(r.status).toBe(409);
    expect(r.body?.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(r.body?.error?.detalles).toEqual([{ sku: skuAgotado, motivo: 'sin_existencia_suficiente' }]);
    expect(pedidosAOdoo.length).toBe(antes);
  });

  it('el 409 no dice cuántas unidades hay: la existencia se publica como estado (#30)', async () => {
    const r = await post({ lineas: [{ sku: skuAgotado, cantidad: 1 }] }, A.key, claveNueva());
    expect(JSON.stringify(r.body)).not.toMatch(/free_qty|disponibles?\s*[:=]\s*\d/i);
  });
});

describe('#33 · Idempotency-Key, acotada por cliente', () => {
  it('el mismo pedido con la misma clave → la MISMA respuesta, y Odoo recibe un solo create', async () => {
    const clave = claveNueva();
    const antes = pedidosAOdoo.length;
    const primera = await post(pedidoValido(), A.key, clave);
    const segunda = await post(pedidoValido(), A.key, clave);
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect(segunda.headers.get('idempotent-replayed')).toBe('true');
    expect(segunda.body).toEqual(primera.body);
    expect(pedidosAOdoo.length).toBe(antes + 1);
  });

  it('la misma clave con otro pedido → 409 IDEMPOTENCY_KEY_REUSED, sin escribir', async () => {
    const clave = claveNueva();
    await post(pedidoValido(), A.key, clave);
    const antes = pedidosAOdoo.length;
    const r = await post({ lineas: [{ sku: skuConExistencia, cantidad: 2 }] }, A.key, clave);
    expect(r.status).toBe(409);
    expect(r.body?.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(pedidosAOdoo.length).toBe(antes);
  });

  it('B reusando la clave de A recibe SU pedido, nunca el de A', async () => {
    // Con la clave indexada sola, B recibiría como respuesta el pedido de A: una
    // fuga entre clientes que no pasa por ningún partner_id.
    const clave = claveNueva();
    const deA = await post(pedidoValido(), A.key, clave);
    const skuB = await skuConExistenciaDe(B);
    const deB = await post({ lineas: [{ sku: skuB, cantidad: 1 }], referenciaCliente: 'OC-PRUEBA-33' }, B.key, clave);
    expect(deB.status, JSON.stringify(deB.body)).toBe(201);
    expect(deB.body?.data?.id).toBe(B.borrador);
    expect(deB.body?.data?.id).not.toBe(deA.body?.data?.id);
    expect(pedidosAOdoo[pedidosAOdoo.length - 1].partnerId).toBe(B.partnerId);
  });

  it('dos peticiones simultáneas con la misma clave → un solo create', async () => {
    const clave = claveNueva();
    const antes = pedidosAOdoo.length;
    const [r1, r2] = await Promise.all([post(pedidoValido(), A.key, clave), post(pedidoValido(), A.key, clave)]);
    expect([r1.status, r2.status].sort()).toEqual(expect.arrayContaining([201]));
    expect([r1.status, r2.status].every((s) => [200, 201, 409].includes(s))).toBe(true);
    expect(pedidosAOdoo.length).toBe(antes + 1);
  });

  it('si Odoo RECHAZA el create, la misma clave se puede reintentar', async () => {
    const clave = claveNueva();
    finalDelCreate = 'rechazo';
    const fallida = await post(pedidoValido(), A.key, clave);
    expect(fallida.status).toBeGreaterThanOrEqual(500);
    finalDelCreate = 'no';
    const reintento = await post(pedidoValido(), A.key, clave);
    expect(reintento.status).toBe(201);
  });

  /*
   * Los fallos AMBIGUOS. El tiempo de espera del cliente XML-RPC es local: el
   * middleware deja de esperar, pero Odoo puede terminar creando el pedido. Antes
   * se marcaba FALLIDO y el reintento con la misma clave creaba un SEGUNDO pedido.
   */
  it('tiempo agotado con el pedido ya creado en Odoo: el reintento devuelve ESE, nunca crea otro', async () => {
    const clave = claveNueva();
    finalDelCreate = 'ambiguo-creado';
    expect((await post(pedidoValido(), A.key, clave)).status).toBeGreaterThanOrEqual(500);
    const creates = pedidosAOdoo.length;
    finalDelCreate = 'no';

    // Dentro del margen, «en curso»: buscar en Odoo todavía no probaría nada.
    process.env.API_PEDIDOS_MARGEN_CONCILIACION_S = '600';
    const pronto = await post(pedidoValido(), A.key, clave);
    expect(pronto.status).toBe(409);
    expect(pronto.body?.error?.message).toMatch(/MISMA clave/);

    // Pasado el margen, se concilia con Odoo y aparece el que se creó.
    process.env.API_PEDIDOS_MARGEN_CONCILIACION_S = '0';
    const tarde = await post(pedidoValido(), A.key, clave);
    expect(tarde.status).toBe(200);
    expect(tarde.body?.data?.id).toBe(A.borrador);
    expect(pedidosAOdoo.length).toBe(creates);
  });

  it('tiempo agotado sin que Odoo lo creara: pasado el margen, el reintento lo crea', async () => {
    const clave = claveNueva();
    finalDelCreate = 'ambiguo-sin-crear';
    expect((await post(pedidoValido(), A.key, clave)).status).toBeGreaterThanOrEqual(500);
    const creates = pedidosAOdoo.length;
    finalDelCreate = 'no';
    process.env.API_PEDIDOS_MARGEN_CONCILIACION_S = '0';

    const reintento = await post(pedidoValido(), A.key, clave);
    expect(reintento.status).toBe(201);
    expect(pedidosAOdoo.length).toBe(creates + 1);
  });

  it('el proceso se cayó con la fila EN_CURSO y el pedido creado: no se queda «en curso» para siempre', async () => {
    const clave = claveNueva();
    const cuerpo = pedidoValido();
    await prisma.apiOrderRequest.create({
      data: { odooPartnerId: A.partnerId, idempotencyKey: clave, requestHash: huellaPedido(cuerpo), apiKeyId: A.keyId },
    });
    creadosEnOdoo.set(`${A.partnerId}|${origenDe(clave)}`, A.borrador);
    const creates = pedidosAOdoo.length;
    process.env.API_PEDIDOS_MARGEN_CONCILIACION_S = '0';

    const r = await post(cuerpo, A.key, clave);
    expect(r.status).toBe(200);
    expect(r.body?.data?.id).toBe(A.borrador);
    expect(pedidosAOdoo.length).toBe(creates);
    expect((await prisma.apiOrderRequest.findFirstOrThrow({ where: { odooPartnerId: A.partnerId, idempotencyKey: clave } })).estado).toBe('CREADO');
  });

  it('la conciliación busca SOLO el pedido de ese cliente con esa clave', async () => {
    // Un pedido de B con la misma clave en Odoo no puede servirle a A.
    const clave = claveNueva();
    finalDelCreate = 'ambiguo-sin-crear';
    expect((await post(pedidoValido(), A.key, clave)).status).toBeGreaterThanOrEqual(500);
    creadosEnOdoo.set(`${B.partnerId}|${origenDe(clave)}`, B.borrador);
    finalDelCreate = 'no';
    process.env.API_PEDIDOS_MARGEN_CONCILIACION_S = '0';

    const r = await post(pedidoValido(), A.key, clave);
    expect(r.status).toBe(201);
    expect(r.body?.data?.id).toBe(A.borrador);
  });
});

describe('#33 · El pedido creado: suyo y de nadie más', () => {
  it('la respuesta cumple el contrato y es un borrador', async () => {
    const r = await post(pedidoValido(), A.key, claveNueva());
    const v = publicOrderDetailResponseSchema.safeParse(r.body);
    expect(v.success, JSON.stringify(v.error?.issues)).toBe(true);
    expect(r.body?.data?.estado).toBe('draft');
    expect(r.headers.get('location')).toBe(`/api/v1/public/orders/${A.borrador}`);
  });

  it('A ve su borrador creado por la API; B recibe el mismo 404 que con uno inexistente', async () => {
    await post(pedidoValido(), A.key, claveNueva());
    const [deA, deB, inexistente] = await Promise.all([
      get(`/orders/${A.borrador}`, A.key),
      get(`/orders/${A.borrador}`, B.key),
      get('/orders/999999999', B.key),
    ]);
    expect(deA.status).toBe(200);
    expect(deB).toEqual(inexistente);
  });

  it('?estado=draft lista los borradores propios creados por la API, y ninguno ajeno', async () => {
    await post(pedidoValido(), A.key, claveNueva());
    const r = await get('/orders?estado=draft&porPagina=100', A.key);
    const ids = (r.body?.data as Array<{ id: number; estado: string }>).map((p) => p.id);
    expect(ids).toContain(A.borrador);
    expect(ids).not.toContain(B.borrador);
  });
});

describe('#33 · Desplegar sin la tabla no rompe la lectura', () => {
  it('si api_order_requests no se puede leer, GET /orders responde igual que antes del POST', async () => {
    // Producción con el código nuevo y sin la migración o sin el GRANT: la
    // lectura de pedidos de todos los clientes no puede caerse por eso.
    const espia = vi.spyOn(prisma.apiOrderRequest, 'findMany').mockRejectedValue(new Error('Table api_order_requests does not exist'));
    try {
      const r = await get('/orders?porPagina=5', A.key);
      expect(r.status).toBe(200);
      const borrador = await get(`/orders/${A.borrador}`, A.key);
      expect(borrador.status).toBe(404);
    } finally {
      espia.mockRestore();
    }
  });
});

/** Una referencia con precio en la tarifa de `c` y existencia en su almacén. */
async function skuConExistenciaDe(c: Cliente): Promise<string> {
  const reglas = await searchRead<{ product_tmpl_id: [number, string] }>(
    'product.pricelist.item',
    [['pricelist_id', '=', c.pricelistId], ['applied_on', '=', '1_product'], ['compute_price', '=', 'fixed'], ['fixed_price', '>', 0]],
    ['product_tmpl_id'],
    { limit: 400, order: 'id desc' },
  );
  const productos = await searchRead<{ default_code: string | false; free_qty: number }>(
    'product.product',
    [['product_tmpl_id', 'in', reglas.map((r) => r.product_tmpl_id[0])], ['sale_ok', '=', true], ['default_code', '!=', false], ['free_qty', '>=', 2]],
    ['default_code', 'free_qty'],
    { limit: 50, context: { warehouse: c.warehouseId, allowed_company_ids: [c.companyId] } },
  );
  const cuenta = new Map<string, number>();
  const todos = await searchRead<{ default_code: string | false }>('product.product', [['default_code', 'in', productos.map((p) => p.default_code)]], ['default_code']);
  for (const p of todos) cuenta.set(String(p.default_code), (cuenta.get(String(p.default_code)) ?? 0) + 1);
  const sku = productos.map((p) => String(p.default_code)).find((s) => cuenta.get(s) === 1);
  if (!sku) throw new Error(`No hay una referencia con existencia en la tarifa de ${c.partnerId}.`);
  return sku;
}
