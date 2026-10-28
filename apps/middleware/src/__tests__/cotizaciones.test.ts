import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { cotizacionesRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { searchRead } from '../odoo/client.js';
import { EstadoInvalido, cotizaciones, diaEnCaracas, estadoDe, estadoDeLaPeticion } from '../services/cotizaciones.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/*
 * Las cotizaciones de ASTA: el administrador ve las de toda la empresa, el
 * vendedor solo las de su cartera y el cliente, ninguna.
 */

describe('cotizaciones · estados y fechas', () => {
  it('los estados de Odoo son tres: abierta, confirmada y cancelada', () => {
    expect(['draft', 'sent'].map(estadoDe)).toEqual(['abierta', 'abierta']);
    expect(['sale', 'done'].map(estadoDe)).toEqual(['confirmada', 'confirmada']);
    expect(estadoDe('cancel')).toBe('cancelada');
  });

  it('sin estado en la URL son las abiertas; uno que no existe es un 400', () => {
    expect(estadoDeLaPeticion({})).toBe('abierta');
    expect(estadoDeLaPeticion({ estado: 'cancelada' })).toBe('cancelada');
    expect(() => estadoDeLaPeticion({ estado: 'draft' })).toThrow(EstadoInvalido);
  });

  it('el día es el de Caracas: las 02:00 UTC del 29 son aún el 28 allí', () => {
    expect(diaEnCaracas('2026-10-29 02:00:00')).toBe('2026-10-28');
    expect(diaEnCaracas('2026-10-29 04:00:00')).toBe('2026-10-29');
  });
});

describe('cotizaciones · la cartera', () => {
  it('un vendedor solo ve cotizaciones de clientes de su cartera', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const todas = await cotizaciones({ rango: { desde, hasta: hoy }, estado: 'confirmada', odooUserId: null });
    expect(todas.filas.length).toBeGreaterThan(0);

    // El vendedor de la ficha del primer cliente con vendedor.
    const fichas = await searchRead<{ id: number; user_id: [number, string] | false }>(
      'res.partner',
      [['id', 'in', [...new Set(todas.filas.map((f) => f.partnerId))]]],
      ['user_id'],
      { context: { active_test: false } },
    );
    const conVendedor = fichas.find((f) => f.user_id)?.user_id;
    expect(conVendedor).toBeTruthy();
    const vendedor = conVendedor as [number, string];

    const suyas = await cotizaciones({ rango: { desde, hasta: hoy }, estado: 'confirmada', odooUserId: vendedor[0] });
    expect(suyas.filas.length).toBeGreaterThan(0);
    expect(suyas.totales.confirmada.cotizaciones).toBeLessThan(todas.totales.confirmada.cotizaciones);
    const deSusFilas = await searchRead<{ id: number; user_id: [number, string] | false }>(
      'res.partner',
      [['id', 'in', [...new Set(suyas.filas.map((f) => f.partnerId))]]],
      ['user_id'],
      { context: { active_test: false } },
    );
    expect(deSusFilas.every((f) => f.user_id && f.user_id[0] === vendedor[0])).toBe(true);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { admin: '', vendedorSinCartera: '', cliente: '' };
const INICIO = new Date();
const AGENTE = 'asta-test-cotizaciones';

async function pedir(ruta: string, quien: keyof typeof tokens) {
  const res = await fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string) {
  const partner = 3_880_000_000 + usuarios.length;
  const u = await prisma.appUser.create({
    data: { email: `test.cotizaciones.${sufijo}@cotizaciones.local`, fullName: `Cotizaciones ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`cot-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@cotizaciones.local' } } })) throw new Error('Restos de @cotizaciones.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin');
  tokens.vendedorSinCartera = await usuarioConToken('VENDEDOR', 'vendedor');
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente');
});

afterAll(async () => {
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  if (usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('cotizaciones · quién las ve', () => {
  it('el administrador, con la forma del contrato', async () => {
    const r = await pedir('/api/v1/admin/cotizaciones?estado=abierta', 'admin');
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const valido = cotizacionesRespuestaSchema.safeParse(r.body);
    expect(valido.success, JSON.stringify(valido.error?.issues?.slice(0, 3))).toBe(true);
    expect(valido.data!.data.filas.every((f) => f.estado === 'abierta')).toBe(true);
  }, 120_000);

  it('un estado que no existe es un 400', async () => {
    expect((await pedir('/api/v1/admin/cotizaciones?estado=draft', 'admin')).status).toBe(400);
  });

  it('un vendedor sin cartera, 403; un cliente, 403 en las dos', async () => {
    expect((await pedir('/api/v1/salesperson/cotizaciones', 'vendedorSinCartera')).status).toBe(403);
    expect((await pedir('/api/v1/salesperson/cotizaciones', 'cliente')).status).toBe(403);
    expect((await pedir('/api/v1/admin/cotizaciones', 'cliente')).status).toBe(403);
    expect((await pedir('/api/v1/admin/cotizaciones', 'vendedorSinCartera')).status).toBe(403);
  });
});
