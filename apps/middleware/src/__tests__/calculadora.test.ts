import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { calcularGanancia } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * La calculadora de ganancia.
 *
 *   · la cuenta: margen sobre el original, descuento al cliente con ASTA
 *   · sin tarifa no hay calculadora (nunca precios que no son los suyos)
 *   · el personal no tiene calculadora
 */

describe('La cuenta', () => {
  const par = { asta: { productId: 1, sku: 'A-1', nombre: 'ASTA 1', precio: 10 }, original: { productId: 2, sku: 'O-1', nombre: 'Original', precio: 50, marca: 'HP' } };

  it('con 30 % de margen y 30 % de descuento', () => {
    const c = calcularGanancia(par, 0.3, 0.3);
    // Original: 50 → se vende a 65, gana 15. ASTA: 65 × 0,7 = 45,5, gana 35,5.
    expect(c.ventaOriginal).toBeCloseTo(65);
    expect(c.ventaAsta).toBeCloseTo(45.5);
    expect(c.gananciaOriginal).toBeCloseTo(15);
    expect(c.gananciaAsta).toBeCloseTo(35.5);
    expect(c.gananciaExtra).toBeCloseTo(20.5);
    expect(c.ahorroCliente).toBeCloseTo(19.5);
  });

  it('con un descuento demasiado grande, gana menos: la diferencia sale negativa', () => {
    const caro = { ...par, asta: { ...par.asta, precio: 40 } };
    expect(calcularGanancia(caro, 0.3, 0.5).gananciaExtra).toBeLessThan(0);
  });

  it('sin descuento, el cliente no ahorra y él se queda con toda la diferencia de coste', () => {
    const c = calcularGanancia(par, 0.3, 0);
    expect(c.ahorroCliente).toBe(0);
    expect(c.gananciaExtra).toBeCloseTo(40);
  });
});

describe('La ruta', () => {
  let server: Server;
  let base = '';
  const usuarios: string[] = [];
  const tokens = { cliente: '', vendedor: '' };
  const INICIO = new Date();
  const AGENTE = 'asta-test-calculadora';

  async function usuarioConToken(rol: 'BRONCE' | 'VENDEDOR', sufijo: string, partner: number) {
    const u = await prisma.appUser.create({ data: { email: `test.calculadora.${sufijo}@calculadora.local`, fullName: `Calculadora ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
    usuarios.push(u.id);
    const sesion = await prisma.userSession.create({
      data: { userId: u.id, refreshTokenHash: hashSecreto(`ca-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
      select: { id: true },
    });
    return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
  }

  const pedir = (ruta: string, quien: keyof typeof tokens) => fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });

  beforeAll(async () => {
    if (await prisma.appUser.count({ where: { email: { endsWith: '@calculadora.local' } } })) throw new Error('Restos de @calculadora.local: límpialos a mano.');
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const dir = server.address();
    if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
    base = `http://127.0.0.1:${dir.port}`;
    // Partner inventado: cabe en el entero de Odoo y no existe, así que no tiene tarifa.
    tokens.cliente = await usuarioConToken('BRONCE', 'cliente', 2_000_000_005);
    tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 2_000_000_006);
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

  it('sin tarifa no hay calculadora: 409, sin precios de otro', async () => {
    const res = await pedir('/api/v1/account/calculadora', 'cliente');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PRICELIST_UNAVAILABLE');
  }, 120_000);

  it('el personal no tiene calculadora', async () => {
    expect((await pedir('/api/v1/account/calculadora', 'vendedor')).status).toBe(403);
  });
});
