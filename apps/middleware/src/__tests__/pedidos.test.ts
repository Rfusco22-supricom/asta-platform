import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { publicOrderDetailResponseSchema, publicOrderListResponseSchema, publicOrderSchema, publicOrderLineSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { executeKw, readGroup, searchRead } from '../odoo/client.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * #33 — `GET /orders` y `GET /orders/:orderId`, con la parte de LECTURA del gate
 * heredado de #36. La de escritura (`POST /orders`) espera a staging (#13).
 *
 * Contra Odoo y MySQL reales, como `publicIsolation.test.ts`. Solo lee.
 *
 * El contenido se contrasta contra Odoo por un camino DISTINTO al del servicio:
 * el servicio filtra por `partner_id child_of`, y aquí la pertenencia se mira con
 * `partner_id.commercial_partner_id`. Si los dos dijeran lo mismo por estar
 * escritos igual, el test no probaría nada.
 *
 * Nada se salta si faltan datos: se LANZA.
 */

const INICIO = new Date(Date.now() - 1000);

let server: Server;
let base = '';
const auditados: AuditEvent[] = [];
let quitarSink: () => void;

interface Cliente {
  partnerId: number;
  userId: string;
  key: string;
  keyId: string;
  /** Un pedido suyo en estado visible. */
  pedido: number;
}

/** A tiene además algún borrador: sirve para probar que no se ven. */
let A: Cliente & { borrador: number };
let B: Cliente;
/** C tiene pedidos a nombre de un CONTACTO hijo: prueba el `child_of`. */
let C: Cliente;
let keySinScope = '';

const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];

async function get(path: string, key?: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: key ? { 'X-API-Key': key } : {} });
  const body = (await res.json().catch(() => null)) as {
    data?: unknown;
    meta?: { total: number; pagina: number; porPagina: number };
    error?: { code?: string };
  } | null;
  return { status: res.status, body };
}

/** El cliente raíz de cada pedido, según Odoo y por otro camino que el servicio. */
async function duenioSegunOdoo(ids: number[]): Promise<Map<number, number>> {
  const pedidos = await searchRead<{ id: number; partner_id: [number, string] }>('sale.order', [['id', 'in', ids]], ['partner_id']);
  const partners = await searchRead<{ id: number; commercial_partner_id: [number, string] }>(
    'res.partner',
    [['id', 'in', [...new Set(pedidos.map((p) => p.partner_id[0]))]], ['active', 'in', [true, false]]],
    ['commercial_partner_id'],
  );
  const raiz = new Map(partners.map((p) => [p.id, p.commercial_partner_id[0]]));
  return new Map(pedidos.map((p) => [p.id, raiz.get(p.partner_id[0]) ?? 0]));
}

/** Dominio de «pedidos de este cliente que no son borrador», escrito sin `child_of`. */
const deCliente = (partnerId: number) => [
  ['partner_id.commercial_partner_id', '=', partnerId],
  ['state', '!=', 'draft'],
];

async function todosLosPedidos(key: string, extra = ''): Promise<Array<{ id: number; estado: string; fecha: string }>> {
  const out: Array<{ id: number; estado: string; fecha: string }> = [];
  for (let pagina = 1; ; pagina++) {
    const r = await get(`/orders?porPagina=100&pagina=${pagina}${extra}`, key);
    expect(r.status).toBe(200);
    const data = r.body?.data as Array<{ id: number; estado: string; fecha: string }>;
    out.push(...data);
    if (data.length < 100 || out.length >= (r.body?.meta?.total ?? 0)) break;
  }
  return out;
}

async function prepararCliente(partnerId: number, sufijo: string): Promise<Omit<Cliente, 'pedido'>> {
  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (usuario && !['BRONCE', 'PLATA', 'GOLD'].includes(usuario.role)) {
    throw new Error(`El partner ${partnerId} ya pertenece a un usuario con rol ${usuario.role}.`);
  }
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: { email: `test.pedidos.${sufijo}@pedidos.local`, fullName: `Cliente pedidos ${sufijo}`, role: 'BRONCE', odooPartnerId: partnerId, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  }
  const k = await issueApiKey({ userId: usuario.id, name: `pedidos ${sufijo}`, scopes: ['ORDERS_READ'], rateLimitPerMinute: 1000 });
  keysCreadas.push(k.id);
  return { partnerId, userId: usuario.id, key: k.plaintext, keyId: k.id };
}

async function unPedido(partnerId: number, dominio: unknown[]): Promise<number> {
  const [p] = await searchRead<{ id: number }>('sale.order', [...deCliente(partnerId).slice(0, 1), ...dominio] as never, ['id'], {
    limit: 1,
    order: 'id desc',
  });
  if (!p) throw new Error(`El cliente ${partnerId} no tiene el pedido que el test necesita.`);
  return p.id;
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

  const staff = new Set(
    (await prisma.appUser.findMany({ where: { role: { notIn: ['BRONCE', 'PLATA', 'GOLD'] } }, select: { odooPartnerId: true } })).map((u) => u.odooPartnerId),
  );

  // Clientes RAÍZ, como en #36: si uno colgara del otro, el de arriba vería
  // legítimamente los pedidos del de abajo.
  const conBorrador = await readGroup<{ partner_id: [number, string] | false; __count: number }>('sale.order', [['state', '=', 'draft']], [], ['partner_id']);
  const conVisibles = await readGroup<{ partner_id: [number, string] | false; __count: number }>('sale.order', [['state', 'in', ['sent', 'sale', 'cancel']]], [], ['partner_id']);
  const visibles = new Map(conVisibles.filter((g) => g.partner_id).map((g) => [(g.partner_id as [number, string])[0], g.__count]));
  const candidatos = [...new Set([...conBorrador, ...conVisibles].filter((g) => g.partner_id).map((g) => (g.partner_id as [number, string])[0]))];
  const raices = new Set(
    (await searchRead<{ id: number; commercial_partner_id: [number, string] }>('res.partner', [['id', 'in', candidatos]], ['commercial_partner_id']))
      .filter((p) => p.commercial_partner_id[0] === p.id && !staff.has(p.id))
      .map((p) => p.id),
  );
  const borradorDe = new Set(conBorrador.filter((g) => g.partner_id).map((g) => (g.partner_id as [number, string])[0]));

  // A: con pedidos visibles Y borradores. B: otro con pedidos visibles. Se
  // eligen con pocos pedidos para que recorrer el listado entero sea rápido.
  const ordenados = [...visibles].filter(([id]) => raices.has(id)).sort((a, b) => a[1] - b[1]);
  const idA = ordenados.find(([id, n]) => borradorDe.has(id) && n >= 3 && n <= 150)?.[0];
  const idB = ordenados.find(([id, n]) => id !== idA && n >= 3 && n <= 150)?.[0];
  if (!idA || !idB) throw new Error('Hacen falta dos clientes raíz con pedidos, uno de ellos con borradores.');

  const a = await prepararCliente(idA, 'a');
  A = { ...a, pedido: await unPedido(idA, [['state', '=', 'sale']]), borrador: await unPedido(idA, [['state', '=', 'draft']]) };
  B = { ...(await prepararCliente(idB, 'b')), pedido: await unPedido(idB, [['state', '!=', 'draft']]) };

  // Solo 5 de cada 5.000 pedidos van a un contacto hijo: sin elegir uno a
  // propósito, cambiar `child_of` por `=` no lo detectaría ningún test.
  const aContacto = await searchRead<{ id: number; partner_id: [number, string] }>(
    'sale.order',
    [['partner_id.parent_id', '!=', false], ['state', 'in', ['sent', 'sale', 'cancel']]],
    ['partner_id'],
    { limit: 50, order: 'id desc' },
  );
  const raicesDeContacto = await duenioSegunOdoo(aContacto.map((p) => p.id));
  const pedidoC = aContacto.find((p) => {
    const r = raicesDeContacto.get(p.id);
    return r && r !== A.partnerId && r !== B.partnerId && !staff.has(r);
  });
  if (!pedidoC) throw new Error('No hay pedidos a nombre de un contacto hijo: el child_of queda SIN PROBAR.');
  C = { ...(await prepararCliente(raicesDeContacto.get(pedidoC.id)!, 'c')), pedido: pedidoC.id };

  const sinScope = await issueApiKey({ userId: A.userId, name: 'pedidos sin scope', scopes: ['INVOICES_READ'] });
  keysCreadas.push(sinScope.id);
  keySinScope = sinScope.plaintext;
}, 180_000);

afterAll(async () => {
  quitarSink?.();
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#33 · Listado: cada key ve solo lo suyo', () => {
  it('TODOS los pedidos que recibe A son de A, según Odoo', async () => {
    const pedidos = await todosLosPedidos(A.key);
    expect(pedidos.length).toBeGreaterThan(0);
    const duenio = await duenioSegunOdoo(pedidos.map((p) => p.id));
    expect(pedidos.filter((p) => duenio.get(p.id) !== A.partnerId)).toEqual([]);
  });

  it('el total coincide con lo que Odoo le atribuye a A, sin borradores', async () => {
    const r = await get('/orders?porPagina=1', A.key);
    const enOdoo = await executeKw<number>('sale.order', 'search_count', [deCliente(A.partnerId)]);
    expect(r.body?.meta?.total).toBe(enOdoo);
  });

  it('ningún borrador sale en el listado', async () => {
    const pedidos = await todosLosPedidos(A.key);
    expect(pedidos.map((p) => p.estado).filter((e) => !['sent', 'sale', 'cancel'].includes(e))).toEqual([]);
    expect(pedidos.map((p) => p.id)).not.toContain(A.borrador);
  });

  it('los pedidos a nombre de un contacto de la empresa también son suyos', async () => {
    // Una sucursal o un empleado del cliente hace el pedido a su nombre: la
    // empresa tiene que verlo, igual que ve sus facturas.
    const pedidos = await todosLosPedidos(C.key);
    expect(pedidos.map((p) => p.id)).toContain(C.pedido);
    const enOdoo = await executeKw<number>('sale.order', 'search_count', [deCliente(C.partnerId)]);
    expect(pedidos.length).toBe(enOdoo);
    expect((await get(`/orders/${C.pedido}`, C.key)).status).toBe(200);
  });

  it('los listados de A y de B no comparten ni un pedido', async () => {
    const [deA, deB] = await Promise.all([todosLosPedidos(A.key), todosLosPedidos(B.key)]);
    const idsA = new Set(deA.map((p) => p.id));
    expect(deB.filter((p) => idsA.has(p.id))).toEqual([]);
  });

  it('filtrar por estado no abre la puerta a otro cliente', async () => {
    // El estado se elige entre los que A TIENE: con uno que no tuviera, el
    // listado saldría vacío y el test pasaría sin probar nada.
    const filtrados = await todosLosPedidos(A.key, '&estado=sale');
    const enOdoo = await executeKw<number>('sale.order', 'search_count', [[...deCliente(A.partnerId), ['state', '=', 'sale']]]);
    expect(filtrados.length).toBe(enOdoo);
    expect(enOdoo).toBeGreaterThan(0);
    expect(filtrados.every((p) => p.estado === 'sale')).toBe(true);
    const duenio = await duenioSegunOdoo(filtrados.map((p) => p.id));
    expect(filtrados.filter((p) => duenio.get(p.id) !== A.partnerId)).toEqual([]);
  });

  it('filtrar por fechas devuelve solo pedidos de esas fechas', async () => {
    const todos = await todosLosPedidos(A.key);
    const dia = todos[Math.floor(todos.length / 2)].fecha.slice(0, 10);
    const delDia = await todosLosPedidos(A.key, `&desde=${dia}&hasta=${dia}`);
    expect(delDia.length).toBeGreaterThan(0);
    expect(delDia.every((p) => p.fecha.slice(0, 10) === dia)).toBe(true);
    expect(delDia.length).toBe(todos.filter((p) => p.fecha.slice(0, 10) === dia).length);
  });

  it('la respuesta cumple el contrato', async () => {
    const r = await get('/orders?porPagina=5', A.key);
    const v = publicOrderListResponseSchema.safeParse(r.body);
    expect(v.success, JSON.stringify(v.error?.issues)).toBe(true);
  });
});

describe('#33 · Detalle: un pedido ajeno no existe', () => {
  it('A ve su pedido, con las líneas que tiene en Odoo', async () => {
    const r = await get(`/orders/${A.pedido}`, A.key);
    expect(r.status).toBe(200);
    const v = publicOrderDetailResponseSchema.safeParse(r.body);
    expect(v.success, JSON.stringify(v.error?.issues)).toBe(true);
    const pedido = v.data!.data;
    expect(pedido.id).toBe(A.pedido);

    const lineas = await searchRead<{ price_subtotal: number }>('sale.order.line', [['order_id', '=', A.pedido], ['display_type', '=', false]], ['price_subtotal']);
    expect(pedido.lineas).toHaveLength(lineas.length);
    const suma = pedido.lineas.reduce((t, l) => t + l.subtotal, 0);
    expect(suma).toBeCloseTo(pedido.subtotal, 1);
  });

  it('el detalle solo lleva los campos del contrato: ni vendedor, ni margen, ni costo', async () => {
    // Si alguien añade `margin` o `user_id` a la respuesta, aquí se ve.
    const r = await get(`/orders/${A.pedido}`, A.key);
    const pedido = r.body!.data as Record<string, unknown> & { lineas: Array<Record<string, unknown>> };
    expect(Object.keys(pedido).sort()).toEqual([...Object.keys(publicOrderSchema.shape), 'lineas'].sort());
    for (const l of pedido.lineas) expect(Object.keys(l).sort()).toEqual(Object.keys(publicOrderLineSchema.shape).sort());
  });

  it('A pidiendo el pedido de B recibe 404, nunca 200', async () => {
    const r = await get(`/orders/${B.pedido}`, A.key);
    expect(r.status).toBe(404);
    expect(r.body?.data).toBeUndefined();
  });

  it('y B pidiendo el de A, igual', async () => {
    expect((await get(`/orders/${A.pedido}`, B.key)).status).toBe(404);
  });

  it('un pedido ajeno, uno inexistente y un borrador propio responden EXACTAMENTE igual', async () => {
    // Un 403 sobre el ajeno le confirmaría a quien prueba ids que existe y es de
    // alguien: con ids consecutivos, eso es enumerar los pedidos de la empresa.
    const [ajeno, inexistente, borrador] = await Promise.all([
      get(`/orders/${B.pedido}`, A.key),
      get('/orders/999999999', A.key),
      get(`/orders/${A.borrador}`, A.key),
    ]);
    expect(ajeno.status).toBe(404);
    expect(ajeno).toEqual(inexistente);
    expect(borrador).toEqual(inexistente);
  });

  it('?partner_id de otro cliente → 400, también en el detalle', async () => {
    expect((await get(`/orders?partner_id=${B.partnerId}`, A.key)).status).toBe(400);
    expect((await get(`/orders/${B.pedido}?partner_id=${B.partnerId}`, A.key)).status).toBe(400);
  });
});

describe('#33 · Rastro de auditoría', () => {
  const denegados = () => auditados.filter((e) => e.action === 'access.denied.partner' && e.targetType === 'sale.order');

  it('pedir el pedido de otro cliente queda registrado', async () => {
    const antes = denegados().length;
    await get(`/orders/${B.pedido}`, A.key);
    const nuevos = denegados().slice(antes);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({
      actorId: A.userId,
      targetId: String(B.pedido),
      metadata: { via: 'api_key', apiKeyId: A.keyId, partnerDelToken: A.partnerId },
    });
  });

  it('un pedido inexistente o un borrador PROPIO no son intentos cruzados', async () => {
    // Lo contrario llenaría la auditoría de ruido (#46).
    const antes = denegados().length;
    await get('/orders/999999999', A.key);
    await get(`/orders/${A.borrador}`, A.key);
    expect(denegados().length).toBe(antes);
  });

  it('un acceso legítimo no genera evento de denegación', async () => {
    const antes = auditados.filter((e) => e.action.startsWith('access.denied')).length;
    await get(`/orders/${A.pedido}`, A.key);
    await get('/orders?porPagina=1', A.key);
    expect(auditados.filter((e) => e.action.startsWith('access.denied')).length).toBe(antes);
  });
});

describe('#33 · Autenticación y entrada', () => {
  it('sin API key → 401; sin ORDERS_READ → 403', async () => {
    expect((await get('/orders')).status).toBe(401);
    const r = await get('/orders', keySinScope);
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('un id mal formado → 400 INVALID_ORDER_ID', async () => {
    const r = await get('/orders/abc', A.key);
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('INVALID_ORDER_ID');
  });

  it('?estado=draft no saca los borradores internos del vendedor, aunque A los tenga', async () => {
    // Desde el POST de #33, `draft` es un filtro válido, pero solo devuelve los
    // pedidos que el cliente creó él mismo por la API (`api_order_requests`).
    // A tiene borradores del vendedor y ninguno creado por la API.
    const r = await get('/orders?estado=draft&porPagina=100', A.key);
    expect(r.status).toBe(200);
    expect((r.body?.data as Array<{ id: number }>).map((p) => p.id)).not.toContain(A.borrador);
  });
});
