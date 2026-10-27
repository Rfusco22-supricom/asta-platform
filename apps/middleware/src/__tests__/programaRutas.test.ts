import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { programaEmpresaRespuestaSchema, trimestreDe } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * Las pantallas del programa de ASTA para Supricom: el administrador ve a
 * todos, el vendedor solo su cartera y el cliente, nada de esto (lo suyo lo ve
 * en «Mis métricas»).
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { admin: '', vendedorSinCartera: '', cliente: '' };
const INICIO = new Date();
const AGENTE = 'asta-test-programa';

async function pedir(ruta: string, quien: keyof typeof tokens) {
  const res = await fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string) {
  const partner = 3_860_000_000 + usuarios.length;
  const u = await prisma.appUser.create({ data: { email: `test.programa.${sufijo}@programa.local`, fullName: `Programa ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`prog-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@programa.local' } } })) throw new Error('Restos de @programa.local: límpialos a mano.');
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

describe('El programa para Supricom', () => {
  it('el administrador ve el trimestre en curso de todos, con la forma del contrato', async () => {
    const r = await pedir('/api/v1/admin/asta/programa', 'admin');
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const valido = programaEmpresaRespuestaSchema.safeParse(r.body);
    expect(valido.success, JSON.stringify(valido.error?.issues?.slice(0, 3))).toBe(true);
    expect(valido.data!.data.trimestre).toBe(trimestreDe(new Date()));
  }, 180_000);

  it('un vendedor sin cartera, 403; un cliente, 403', async () => {
    expect((await pedir('/api/v1/salesperson/asta/programa', 'vendedorSinCartera')).status).toBe(403);
    expect((await pedir('/api/v1/salesperson/asta/programa', 'cliente')).status).toBe(403);
    expect((await pedir('/api/v1/admin/asta/programa', 'cliente')).status).toBe(403);
  });
});
