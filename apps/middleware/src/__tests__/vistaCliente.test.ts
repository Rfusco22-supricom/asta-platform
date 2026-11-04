import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { facturasClienteRespuestaSchema, pedidosClienteRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * «Usuarios» del administrador: el panel de un cliente, solo para mirar.
 *
 *   · el administrador lee lo mismo que vería el cliente (mismas respuestas)
 *   · solo lectura: no hay forma de escribir en su nombre
 *   · ni un vendedor ni un cliente pueden mirar el panel de otro
 *
 * Partner inventado (2_000_000_007): cabe en el entero de Odoo y no existe.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { admin: '', vendedor: '', cliente: '' };
const PARTNER = 2_000_000_007;
const INICIO = new Date();
const AGENTE = 'asta-test-vista-cliente';

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({ data: { email: `test.vista.${sufijo}@vista.local`, fullName: `Vista ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`vc-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

const pedir = (metodo: 'GET' | 'POST', ruta: string, quien: keyof typeof tokens) =>
  fetch(`${base}${ruta}`, { method: metodo, headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}`, 'Content-Type': 'application/json' }, body: metodo === 'POST' ? '{}' : undefined });

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@vista.local' } } })) throw new Error('Restos de @vista.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 2_000_000_008);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 2_000_000_009);
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente', 2_000_000_010);
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

describe('El administrador mira el panel de un cliente', () => {
  it('lee sus facturas y sus pedidos con la misma forma que él', async () => {
    const f = await pedir('GET', `/api/v1/admin/vista-cliente/${PARTNER}/facturas?vista=todas`, 'admin');
    expect(f.status).toBe(200);
    expect(facturasClienteRespuestaSchema.parse(await f.json()).data).toMatchObject({ vista: 'todas', facturas: [], total: 0 });
    const p = await pedir('GET', `/api/v1/admin/vista-cliente/${PARTNER}/pedidos`, 'admin');
    expect(p.status).toBe(200);
    expect(pedidosClienteRespuestaSchema.parse(await p.json()).data).toEqual([]);
  }, 60_000);

  it('un cliente que no es un número: 400', async () => {
    expect((await pedir('GET', '/api/v1/admin/vista-cliente/abc/pedidos', 'admin')).status).toBe(400);
  });

  it('solo lectura: enviar un pedido o marcar sell-out en su nombre no existe', async () => {
    expect((await pedir('POST', `/api/v1/admin/vista-cliente/${PARTNER}/pedidos`, 'admin')).status).toBe(404);
    expect((await pedir('POST', `/api/v1/admin/vista-cliente/${PARTNER}/sellout/marcar`, 'admin')).status).toBe(404);
  });

  it('ni un vendedor ni un cliente pueden mirar el panel de otro', async () => {
    expect((await pedir('GET', `/api/v1/admin/vista-cliente/${PARTNER}/pedidos`, 'vendedor')).status).toBe(403);
    expect((await pedir('GET', `/api/v1/admin/vista-cliente/${PARTNER}/pedidos`, 'cliente')).status).toBe(403);
  });
});
