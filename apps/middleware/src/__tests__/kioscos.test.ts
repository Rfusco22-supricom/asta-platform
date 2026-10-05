import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { almacenesKioscoRespuestaSchema, kioscoConTokenRespuestaSchema, kioscosRespuestaSchema, type AlmacenKiosco, type KioscoConToken } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { olvidarVistos } from '../services/kioscos.service.js';

/**
 * #120 · Las tablets del kiosco, dadas de alta desde el panel.
 *
 * Lo que se vigila:
 *
 *   · solo el administrador da de alta, renueva o corta una tablet
 *   · el token sale una vez, y abre `/api/v1/kiosk` y NADA más: ni la API
 *     pública del cliente, ni otra cosa
 *   · desactivada, o con el token renovado, el viejo deja de entrar en el acto
 *   · lo que busca la tablet queda a su nombre en la telemetría, sin usuario
 *   · la compañía sale del almacén, no de la petición
 *
 * Usa el Odoo real para leer almacenes (solo lectura), como el resto de la
 * batería. Datos: tablets «ZZ Kiosco …», que se borran al final.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { admin: '', vendedor: '' };
const creados: string[] = [];
let almacen: AlmacenKiosco;
const INICIO = new Date();
/** Marca de las peticiones de esta batería en `api_request_logs`, para borrar solo las suyas. */
const AGENTE = 'asta-test-kioscos';

async function pedir<B>(metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cabeceras: Record<string, string>, cuerpo?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'User-Agent': AGENTE, ...cabeceras, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as B };
}
const como = (quien: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[quien]}` });
const tablet = (token: string) => ({ 'X-API-Key': token, 'X-App-Version': '1.0.0-test' });

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string) {
  const u = await prisma.appUser.create({
    data: { email: `test.kiosco.${sufijo}@kioscos.local`, fullName: `Kiosco ${sufijo}`, role: rol, odooPartnerId: 3_820_000_000 + usuarios.length, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`kio-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

async function alta(nombre: string): Promise<KioscoConToken> {
  const r = await pedir<{ data: KioscoConToken }>('POST', '/api/v1/admin/kioscos', como('admin'), { nombre, tienda: 'Tienda de prueba', odooWarehouseId: almacen.warehouseId });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  creados.push(r.body.data.kiosco.id);
  return r.body.data;
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@kioscos.local' } } })) throw new Error('Restos de @kioscos.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin');
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor');

  const r = await pedir<{ data: AlmacenKiosco[] }>('GET', '/api/v1/admin/kioscos/almacenes', como('admin'));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(almacenesKioscoRespuestaSchema.safeParse(r.body).success).toBe(true);
  // Lanza en vez de saltarse: sin un almacén no hay nada que probar.
  if (!r.body.data.length) throw new Error('Odoo no devolvió ningún almacén');
  almacen = r.body.data[0]!;
  olvidarVistos();
}, 120_000);

afterAll(async () => {
  // La bitácora de lo que pidieron las tablets: la regla de 5xx de las alertas
  // cuenta todas las filas de los últimos 15 min, y estas falsearían su test.
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  if (creados.length) {
    await prisma.recommendationEvent.deleteMany({ where: { deviceId: { in: creados } } });
    await prisma.kioskDevice.deleteMany({ where: { id: { in: creados } } });
  }
  if (usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#120 · Alta de tablets', () => {
  it('un vendedor no ve ni da de alta tablets: 403', async () => {
    expect((await pedir('GET', '/api/v1/admin/kioscos', como('vendedor'))).status).toBe(403);
    expect((await pedir('POST', '/api/v1/admin/kioscos', como('vendedor'), { nombre: 'ZZ Kiosco X', tienda: 'X', odooWarehouseId: almacen.warehouseId })).status).toBe(403);
  });

  it('el alta devuelve el token una vez, y la compañía sale del almacén', async () => {
    const r = await alta('ZZ Kiosco alta');
    expect(kioscoConTokenRespuestaSchema.safeParse({ data: r }).success).toBe(true);
    expect(r.token).toMatch(/^asta_kio_[A-Za-z0-9_-]{43}$/);
    expect([r.kiosco.odooCompanyId, r.kiosco.almacen]).toEqual([almacen.companyId, almacen.nombre]);
    // En la base solo está el hash.
    const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id: r.kiosco.id } });
    expect(fila.tokenHash).not.toContain(r.token);

    const lista = await pedir<{ data: Array<{ id: string }> }>('GET', '/api/v1/admin/kioscos', como('admin'));
    expect(kioscosRespuestaSchema.safeParse(lista.body).success).toBe(true);
    expect(lista.body.data.map((k) => k.id)).toContain(r.kiosco.id);
  });

  it('un almacén que no existe en Odoo: 400', async () => {
    const r = await pedir('POST', '/api/v1/admin/kioscos', como('admin'), { nombre: 'ZZ Kiosco malo', tienda: 'Tienda de prueba', odooWarehouseId: 999_999 });
    expect(r.status).toBe(400);
  });
});

describe('#120 · El token de la tablet', () => {
  it('abre el recomendador del kiosco, y lo buscado queda a nombre de la tablet', async () => {
    const { kiosco, token } = await alta('ZZ Kiosco busca');
    const r = await pedir<{ data: unknown[]; meta: { busquedaId: string | null } }>('GET', '/api/v1/kiosk/recommender/printers?q=zzkiosco404', tablet(token));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.meta.busquedaId).not.toBeNull();

    const evento = await prisma.recommendationEvent.findFirstOrThrow({ where: { id: BigInt(r.body.meta.busquedaId!) } });
    expect([evento.deviceId, evento.userId, evento.searchQuery]).toEqual([kiosco.id, null, 'zzkiosco404']);

    const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id: kiosco.id } });
    expect(fila.lastSeenAt).not.toBeNull();
    expect(fila.appVersion).toBe('1.0.0-test');
  });

  it('no abre la API pública del cliente', async () => {
    const { token } = await alta('ZZ Kiosco publica');
    expect((await pedir('GET', '/api/v1/public/recommender/printers?q=m404', tablet(token))).status).toBe(401);
    expect((await pedir('GET', '/api/v1/public/invoices', tablet(token))).status).toBe(401);
  });

  it('sin token, o con uno inventado: 401', async () => {
    expect((await pedir('GET', '/api/v1/kiosk/recommender/printers?q=m404', {})).status).toBe(401);
    expect((await pedir('GET', '/api/v1/kiosk/recommender/printers?q=m404', tablet(`asta_kio_${'A'.repeat(43)}`))).status).toBe(401);
  });

  it('desactivada no entra; reactivada, sí', async () => {
    const { kiosco, token } = await alta('ZZ Kiosco corte');
    expect((await pedir('PATCH', `/api/v1/admin/kioscos/${kiosco.id}`, como('admin'), { activo: false })).status).toBe(200);
    expect((await pedir('GET', '/api/v1/kiosk/recommender/printers?q=m404', tablet(token))).status).toBe(401);
    expect((await pedir('PATCH', `/api/v1/admin/kioscos/${kiosco.id}`, como('admin'), { activo: true })).status).toBe(200);
    expect((await pedir('GET', '/api/v1/kiosk/recommender/printers?q=m404', tablet(token))).status).toBe(200);
  });

  it('con un token nuevo, el viejo deja de valer en el acto', async () => {
    const { kiosco, token: viejo } = await alta('ZZ Kiosco renueva');
    const r = await pedir<{ data: KioscoConToken }>('POST', `/api/v1/admin/kioscos/${kiosco.id}/token`, como('admin'));
    expect(r.status).toBe(200);
    expect(r.body.data.token).not.toBe(viejo);
    expect((await pedir('GET', '/api/v1/kiosk/recommender/printers?q=m404', tablet(viejo))).status).toBe(401);
    expect((await pedir('GET', '/api/v1/kiosk/recommender/printers?q=m404', tablet(r.body.data.token))).status).toBe(200);
  });
});
