import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { datosFlyerRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { tipoDeImagen } from '../services/flyers.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * «Mis flyers».
 *
 *   · el cliente recibe los productos ASTA con foto, y la foto de uno de ellos
 *   · la foto de un producto que no es ASTA no sale, aunque se pida por su id
 *   · el personal no tiene «Mis flyers»
 *
 * Partner inventado (2_000_000_003): cabe en el entero de Odoo y no existe, así
 * que su tienda sale sin datos y no compra nada.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { cliente: '', vendedor: '' };
const INICIO = new Date();
const AGENTE = 'asta-test-flyers';

async function usuarioConToken(rol: 'BRONCE' | 'VENDEDOR', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({ data: { email: `test.flyers.${sufijo}@flyers.local`, fullName: `Flyers ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`fl-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

const pedir = (ruta: string, quien: keyof typeof tokens) => fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@flyers.local' } } })) throw new Error('Restos de @flyers.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente', 2_000_000_003);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 2_000_000_004);
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

describe('El tipo de la foto', () => {
  it('por los primeros bytes: JPEG, PNG o WebP', () => {
    expect(tipoDeImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoDeImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(tipoDeImagen(Buffer.from('RIFF'))).toBe('image/webp');
  });
});

describe('Mis flyers', () => {
  it('los productos ASTA con foto, y la foto de uno', async () => {
    const res = await pedir('/api/v1/account/flyers', 'cliente');
    expect(res.status).toBe(200);
    const d = datosFlyerRespuestaSchema.parse(await res.json()).data;
    expect(d.productos.length).toBeGreaterThan(0);
    // No compra nada: ninguno marcado.
    expect(d.productos.some((p) => p.loCompra)).toBe(false);
    const foto = await pedir(`/api/v1/account/flyers/fotos/${d.productos[0]!.templateId}`, 'cliente');
    expect(foto.status).toBe(200);
    expect(foto.headers.get('content-type')).toMatch(/^image\//);
    expect((await foto.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  }, 120_000);

  it('la foto de un producto que no es ASTA no sale', async () => {
    expect((await pedir('/api/v1/account/flyers/fotos/1', 'cliente')).status).toBe(404);
    expect((await pedir('/api/v1/account/flyers/fotos/abc', 'cliente')).status).toBe(404);
  }, 60_000);

  it('el personal no tiene «Mis flyers»', async () => {
    expect((await pedir('/api/v1/account/flyers', 'vendedor')).status).toBe(403);
  });
});
