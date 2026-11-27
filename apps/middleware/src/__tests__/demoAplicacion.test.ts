import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { demoAplicacionRespuestaSchema, type DemoAplicacion } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { abrirDemo, finDelDia, olvidarCuentasDemo, verificarTokenDemo } from '../services/demoAplicacion.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * La demostración de la aplicación ASTA para el vendedor:
 *
 *   · solo el personal la abre; un cliente, no
 *   · el token abre `/api/v1/kiosk` (el recomendador) y nada más
 *   · lleva las existencias de la sede del vendedor, y caduca al acabar el día
 *   · un token tocado, caducado, o de una cuenta que no es del personal, no vale
 *   · lo que se busca queda a nombre del vendedor, no de una tablet
 *   · no crea tablets
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const sesiones: string[] = [];
const tokens = { vendedor: '', sinSede: '', cliente: '' };
let vendedorId = '';
const INICIO = new Date();
const AGENTE = 'asta-test-demo-aplicacion';
/** Un usuario de Odoo con cartera y sede (el de las cuentas de prueba del vendedor). */
const VENDEDOR_ODOO = 406;

async function pedir<B>(metodo: 'GET' | 'POST', ruta: string, cabeceras: Record<string, string>) {
  const res = await fetch(`${base}${ruta}`, { method: metodo, headers: { 'User-Agent': AGENTE, ...cabeceras } });
  return { status: res.status, body: (await res.json().catch(() => null)) as B };
}
const como = (quien: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[quien]}` });
const app = (token: string) => ({ 'X-API-Key': token, 'X-App-Version': 'web-test' });

async function usuarioConToken(rol: 'VENDEDOR' | 'BRONCE', sufijo: string) {
  const u = await prisma.appUser.create({
    data: { email: `test.demo.${sufijo}@demo-app.local`, fullName: `Demo ${sufijo}`, role: rol, odooPartnerId: 3_830_000_000 + usuarios.length, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`demo-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

/** La cuenta de prueba que ya existe con ese usuario de Odoo (`odoo_user_id` es único), con una sesión solo para el test. */
async function vendedorConSede(): Promise<string> {
  const u = await prisma.appUser.findFirstOrThrow({ where: { odooUserId: VENDEDOR_ODOO, role: 'VENDEDOR' }, select: { id: true, odooPartnerId: true } });
  vendedorId = u.id;
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`demo-sede-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1), userAgent: AGENTE },
    select: { id: true },
  });
  sesiones.push(sesion.id);
  return emitirAccessToken({ sub: u.id, role: 'VENDEDOR', odooPartnerId: u.odooPartnerId, odooUserId: VENDEDOR_ODOO, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@demo-app.local' } } })) throw new Error('Restos de @demo-app.local: límpialos a mano.');
  const a = createApp();
  await new Promise<void>((resolve) => {
    server = a.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.vendedor = await vendedorConSede();
  tokens.sinSede = await usuarioConToken('VENDEDOR', 'sin-sede');
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente');
}, 60_000);

afterAll(async () => {
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  const todos = [...usuarios, vendedorId].filter(Boolean);
  await prisma.recommendationEvent.deleteMany({ where: { createdAt: { gte: INICIO }, userId: { in: todos } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: INICIO }, actorId: { in: todos } } });
  if (sesiones.length) await prisma.userSession.deleteMany({ where: { id: { in: sesiones } } });
  if (usuarios.length) await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('Demostración de la aplicación ASTA: reglas', () => {
  it('caduca a la medianoche de Caracas (04:00 UTC)', () => {
    expect(finDelDia(new Date('2026-11-27T15:00:00Z')).toISOString()).toBe('2026-11-28T04:00:00.000Z');
    expect(finDelDia(new Date('2026-11-28T03:59:00Z')).toISOString()).toBe('2026-11-28T04:00:00.000Z');
    expect(finDelDia(new Date('2026-11-28T04:01:00Z')).toISOString()).toBe('2026-11-29T04:00:00.000Z');
  });

  it('un token tocado, caducado o de una cuenta que no es del personal no vale', async () => {
    const d = await abrirDemo(vendedorId, null);
    expect(await verificarTokenDemo(d.token)).not.toBeNull();
    // Tocado: otra letra en los datos invalida la firma.
    const [cuerpo, firma] = d.token.slice('asta_demo_'.length).split('.') as [string, string];
    const otro = cuerpo.slice(0, -2) + (cuerpo.endsWith('A') ? 'BB' : 'AA');
    expect(await verificarTokenDemo(`asta_demo_${otro}.${firma}`)).toBeNull();
    // Caducado.
    expect(await verificarTokenDemo(d.token, new Date(Date.parse(d.caduca) + 1))).toBeNull();
    // De un cliente: la firma vale, la cuenta no.
    const cliente = usuarios[1]!;
    olvidarCuentasDemo();
    expect(await verificarTokenDemo((await abrirDemo(cliente, null)).token)).toBeNull();
  });
});

describe('Demostración de la aplicación ASTA: por la API', () => {
  let demo: DemoAplicacion;

  it('el vendedor la abre con las existencias de su sede, y queda en la bitácora', async () => {
    const r = await pedir<{ data: DemoAplicacion }>('POST', '/api/v1/salesperson/aplicacion/demo', como('vendedor'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(demoAplicacionRespuestaSchema.safeParse(r.body).success).toBe(true);
    demo = r.body.data;
    expect(demo.sede).not.toBeNull();
    expect(Date.parse(demo.caduca)).toBeGreaterThan(Date.now());
    await esperarBitacora(INICIO);
    expect(await prisma.auditLog.count({ where: { actorId: vendedorId, action: 'aplicacion.demo_abierta', createdAt: { gte: INICIO } } })).toBeGreaterThan(0);
  }, 60_000);

  it('un vendedor sin usuario de Odoo también, pero sin existencias (solo compatibilidades)', async () => {
    const r = await pedir<{ data: DemoAplicacion }>('POST', '/api/v1/salesperson/aplicacion/demo', como('sinSede'));
    expect(r.status).toBe(201);
    expect(r.body.data.sede).toBeNull();
  });

  it('un cliente no puede abrirla', async () => {
    expect((await pedir('POST', '/api/v1/salesperson/aplicacion/demo', como('cliente'))).status).toBe(403);
  });

  it('abre el recomendador, y lo buscado queda a nombre del vendedor, no de una tablet', async () => {
    const dispositivos = await prisma.kioskDevice.count();
    expect((await pedir('GET', '/api/v1/kiosk/latido', app(demo.token))).status).toBe(200);
    const r = await pedir<{ meta: { busquedaId: string | null } }>('GET', '/api/v1/kiosk/recommender/printers?q=zzdemo404', app(demo.token));
    expect(r.status).toBe(200);
    expect(r.body.meta.busquedaId).toBeTruthy();
    const evento = await prisma.recommendationEvent.findFirstOrThrow({ where: { id: BigInt(r.body.meta.busquedaId!) } });
    expect(evento.userId).toBe(vendedorId);
    expect(evento.deviceId).toBeNull();
    expect(await prisma.kioskDevice.count()).toBe(dispositivos);
  }, 60_000);

  it('y nada más: ni la API pública ni el panel', async () => {
    expect((await pedir('GET', '/api/v1/public/recommender/printers?q=m404', app(demo.token))).status).toBe(401);
    expect((await pedir('GET', '/api/v1/salesperson/portfolio', { Authorization: `Bearer ${demo.token}` })).status).toBe(401);
  });

  it('un token tocado no entra', async () => {
    expect((await pedir('GET', '/api/v1/kiosk/latido', app(`${demo.token.slice(0, -3)}xyz`))).status).toBe(401);
  });
});
