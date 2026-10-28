import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import {
  almacenesKioscoRespuestaSchema,
  codigoRevisionRespuestaSchema,
  codigoTabletRespuestaSchema,
  estadoCodigoTabletRespuestaSchema,
  kioscoConTokenRespuestaSchema,
  kioscosRespuestaSchema,
  tabletVinculadaRespuestaSchema,
  type AlmacenKiosco,
  type CodigoTablet,
  type EstadoCodigoTablet,
  type Kiosco,
  type KioscoConToken,
} from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { MAX_CODIGOS_VIVOS, olvidarVistos } from '../services/kioscos.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

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
 *   · sin token, una tablet solo puede vincularse con un código del panel, de
 *     un solo uso y que caduca; el de los revisores, de varios y revocable
 *   · un cliente vincula y ve SOLO sus tablets, y esas no enseñan existencias
 *
 * Usa el Odoo real para leer almacenes (solo lectura), como el resto de la
 * batería. Datos: tablets «ZZ Kiosco …», que se borran al final.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { admin: '', vendedor: '', cliente: '', otroCliente: '' };
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

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string) {
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
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente');
  tokens.otroCliente = await usuarioConToken('BRONCE', 'otro-cliente');

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
  // Las últimas se escriben después de responder: hay que esperarlas.
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  // Las tablets vinculadas con un código de esta batería, y sus códigos.
  const vinculadas = await prisma.kioskDevice.findMany({ where: { createdAt: { gte: INICIO }, label: { startsWith: 'ZZ ' } }, select: { id: true } });
  creados.push(...vinculadas.map((d) => d.id));
  await prisma.kioskCodigo.deleteMany({ where: { creadoPor: { in: usuarios } } });
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

  it('el latido marca la tablet como viva sin buscar nada (#46)', async () => {
    const { kiosco, token } = await alta('ZZ Kiosco latido');
    olvidarVistos();
    const r = await pedir('GET', '/api/v1/kiosk/latido', tablet(token));
    expect(r.status).toBe(200);
    const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id: kiosco.id } });
    expect(fila.lastSeenAt).not.toBeNull();
    expect((await pedir('GET', '/api/v1/kiosk/latido', {})).status).toBe(401);
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

describe('Vincular una tablet con un código del panel', () => {
  const vincular = (codigo: string, plataforma = 'ios') =>
    pedir<{ data: { token: string; nombre: string; conExistencias: boolean } }>('POST', '/api/v1/kiosk/vincular', { 'X-App-Version': '1.0.0-test' }, {
      codigo,
      plataforma,
      modelo: 'iPad de prueba',
      version: '1.0.0-test',
    });
  const estado = (ruta: string, quien: keyof typeof tokens) => pedir<{ data: EstadoCodigoTablet }>('GET', ruta, como(quien));

  async function codigoSupricom(nombre: string): Promise<CodigoTablet> {
    const r = await pedir<{ data: CodigoTablet }>('POST', '/api/v1/admin/kioscos/codigos', como('admin'), { nombre, tienda: 'Tienda de prueba', odooWarehouseId: almacen.warehouseId });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(codigoTabletRespuestaSchema.safeParse(r.body).success).toBe(true);
    return r.body.data;
  }
  async function codigoCliente(quien: 'cliente' | 'otroCliente', nombre: string): Promise<CodigoTablet> {
    const r = await pedir<{ data: CodigoTablet }>('POST', '/api/v1/account/tablets/codigos', como(quien), { nombre, tienda: 'Sucursal de prueba' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data;
  }

  it('Supricom: 6 dígitos que caducan en minutos; con ellos la tablet recibe su token y enseña existencias', async () => {
    const c = await codigoSupricom('ZZ Kiosco vinculada');
    expect(c.codigo).toMatch(/^\d{6}$/);
    const minutos = (new Date(c.expiraEn!).getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(9);
    expect(minutos).toBeLessThanOrEqual(10);
    expect((await estado(`/api/v1/admin/kioscos/codigos/${c.id}`, 'admin')).body.data).toEqual({ estado: 'PENDIENTE', tablet: null });

    // Como se lee en la pantalla: «482 913».
    const r = await vincular(`${c.codigo.slice(0, 3)} ${c.codigo.slice(3)}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(tabletVinculadaRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data).toMatchObject({ nombre: 'ZZ Kiosco vinculada', conExistencias: true });
    expect(r.body.data.token).toMatch(/^asta_kio_[A-Za-z0-9_-]{43}$/);
    expect((await pedir('GET', '/api/v1/kiosk/latido', tablet(r.body.data.token))).status).toBe(200);

    const e = await estado(`/api/v1/admin/kioscos/codigos/${c.id}`, 'admin');
    expect(estadoCodigoTabletRespuestaSchema.safeParse(e.body).success).toBe(true);
    expect(e.body.data.estado).toBe('USADO');
    const fila = await prisma.kioskDevice.findUniqueOrThrow({ where: { id: e.body.data.tablet!.id } });
    expect([fila.odooWarehouseId, fila.odooCompanyId, fila.odooPartnerId, fila.appVersion]).toEqual([almacen.warehouseId, almacen.companyId, null, '1.0.0-test']);
    expect(fila.tokenHash).not.toContain(r.body.data.token);
  });

  it('el código es de un solo uso: la segunda tablet no entra', async () => {
    const c = await codigoSupricom('ZZ Kiosco un uso');
    expect((await vincular(c.codigo)).status).toBe(201);
    expect((await vincular(c.codigo)).status).toBe(404);
  });

  it('caducado, inventado o con otra forma: 404, siempre el mismo', async () => {
    const c = await codigoSupricom('ZZ Kiosco caducado');
    await prisma.kioskCodigo.update({ where: { id: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const caducado = await vincular(c.codigo);
    expect(caducado.status).toBe(404);
    expect((await estado(`/api/v1/admin/kioscos/codigos/${c.id}`, 'admin')).body.data.estado).toBe('CADUCADO');
    const otraForma = await vincular('12ab34');
    expect(otraForma.status).toBe(404);
    expect(otraForma.body).toEqual(caducado.body);
  });

  it('un cliente vincula tablets de su tienda: sin almacén, solo compatibilidades', async () => {
    const c = await codigoCliente('cliente', 'ZZ Kiosco del cliente');
    expect(c.codigo).toMatch(/^\d{6}$/);
    const r = await vincular(c.codigo, 'android');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.conExistencias).toBe(false);

    const lista = await pedir<{ data: Kiosco[] }>('GET', '/api/v1/account/tablets', como('cliente'));
    expect(kioscosRespuestaSchema.safeParse(lista.body).success).toBe(true);
    const suya = lista.body.data.find((k) => k.nombre === 'ZZ Kiosco del cliente')!;
    expect(suya).toMatchObject({ odooWarehouseId: null, almacen: null, cliente: 'Kiosco cliente', tienda: 'Sucursal de prueba' });

    // Un producto compatible sin existencia: la tablet del cliente no la enseña.
    const conCompatibles = await prisma.cartridgePrinterModel.findFirst({
      where: { status: 'VALIDADA', cartridge: { products: { some: { status: 'VALIDADA' } } } },
      select: { printerModelId: true },
    });
    if (!conCompatibles) throw new Error('No hay ninguna impresora con compatibilidades validadas para probar');
    const comp = await pedir<{ data: Array<{ stock: string | null }> }>('GET', `/api/v1/kiosk/recommender/printers/${conCompatibles.printerModelId}/compatible`, tablet(r.body.data.token));
    expect(comp.status, JSON.stringify(comp.body)).toBe(200);
    expect(comp.body.data.length).toBeGreaterThan(0);
    expect(comp.body.data.every((p) => p.stock === null)).toBe(true);
  });

  it('cada cliente ve y desactiva solo sus tablets', async () => {
    const c = await codigoCliente('cliente', 'ZZ Kiosco ajena');
    const r = await vincular(c.codigo);
    const id = (await prisma.kioskDevice.findFirstOrThrow({ where: { label: 'ZZ Kiosco ajena' } })).id;

    const delOtro = await pedir<{ data: Kiosco[] }>('GET', '/api/v1/account/tablets', como('otroCliente'));
    expect(delOtro.body.data.map((k) => k.id)).not.toContain(id);
    expect((await pedir('PATCH', `/api/v1/account/tablets/${id}`, como('otroCliente'), { activo: false })).status).toBe(404);
    expect((await estado(`/api/v1/account/tablets/codigos/${c.id}`, 'otroCliente')).status).toBe(404);

    expect((await pedir('PATCH', `/api/v1/account/tablets/${id}`, como('cliente'), { activo: false })).status).toBe(200);
    expect((await pedir('GET', '/api/v1/kiosk/latido', tablet(r.body.data.token))).status).toBe(401);
  });

  it('ni el personal entra en las tablets de cliente, ni el cliente en las de administración', async () => {
    expect((await pedir('GET', '/api/v1/account/tablets', como('vendedor'))).status).toBe(403);
    expect((await pedir('POST', '/api/v1/account/tablets/codigos', como('admin'), { nombre: 'ZZ Kiosco X' })).status).toBe(403);
    expect((await pedir('POST', '/api/v1/admin/kioscos/codigos', como('cliente'), { nombre: 'ZZ Kiosco X', tienda: 'X', odooWarehouseId: almacen.warehouseId })).status).toBe(403);
    expect((await pedir('POST', '/api/v1/admin/kioscos/codigo-revision', como('cliente'))).status).toBe(403);
  });

  it(`con ${MAX_CODIGOS_VIVOS} códigos sin usar, no da más: 429`, async () => {
    for (let i = 0; i < MAX_CODIGOS_VIVOS; i++) await codigoCliente('otroCliente', `ZZ Kiosco tope ${i}`);
    const r = await pedir<{ error: { code: string } }>('POST', '/api/v1/account/tablets/codigos', como('otroCliente'), { nombre: 'ZZ Kiosco de más' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });

  it('el código de los revisores: 12 dígitos, sin caducidad, varios usos, solo compatibilidades y revocable', async () => {
    const c = await pedir<{ data: CodigoTablet }>('POST', '/api/v1/admin/kioscos/codigo-revision', como('admin'));
    expect(c.status).toBe(201);
    expect(c.body.data.codigo).toMatch(/^\d{12}$/);
    expect(c.body.data.expiraEn).toBeNull();

    const uno = await vincular(c.body.data.codigo);
    const dos = await vincular(c.body.data.codigo, 'android');
    expect([uno.status, dos.status]).toEqual([201, 201]);
    expect(uno.body.data.conExistencias).toBe(false);
    expect(uno.body.data.nombre).not.toBe(dos.body.data.nombre);
    for (const r of [uno, dos]) {
      const d = await prisma.kioskDevice.findFirstOrThrow({ where: { label: r.body.data.nombre, createdAt: { gte: INICIO } } });
      creados.push(d.id);
    }

    const info = await pedir<{ data: { usos: number } }>('GET', '/api/v1/admin/kioscos/codigo-revision', como('admin'));
    expect(codigoRevisionRespuestaSchema.safeParse(info.body).success).toBe(true);
    expect(info.body.data.usos).toBe(2);

    // Uno nuevo revoca el anterior; revocarlo, también el nuevo.
    const nuevo = await pedir<{ data: CodigoTablet }>('POST', '/api/v1/admin/kioscos/codigo-revision', como('admin'));
    expect((await vincular(c.body.data.codigo)).status).toBe(404);
    expect((await pedir('POST', '/api/v1/admin/kioscos/codigo-revision/revocar', como('admin'))).status).toBe(200);
    expect((await vincular(nuevo.body.data.codigo)).status).toBe(404);
    expect((await pedir<{ data: null }>('GET', '/api/v1/admin/kioscos/codigo-revision', como('admin'))).body.data).toBeNull();
    // Las tablets que ya entraron siguen: se cortan desde la lista.
    expect((await pedir('GET', '/api/v1/kiosk/latido', tablet(uno.body.data.token))).status).toBe(200);
  });
});
