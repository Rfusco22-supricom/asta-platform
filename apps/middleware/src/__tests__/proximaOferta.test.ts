import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { PRODUCTOS_OFERTA, ofertaClienteRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { ofertaPara, type Compras } from '../services/proximaOferta.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * La próxima mejor oferta.
 *
 *   · se ofrece lo que compran los parecidos y él no, el más parecido pesa más
 *   · nunca lo que ya compra, ni lo que no se puede vender
 *   · sin compras de ASTA, los más vendidos
 *   · el vendedor solo la ve de su cartera
 */

const compras = (filas: Record<number, Record<number, number>>): Compras =>
  new Map(Object.entries(filas).map(([c, ps]) => [Number(c), new Map(Object.entries(ps).map(([p, u]) => [Number(p), u]))]));

describe('La oferta', () => {
  // El 1 compra 10 y 11. El 2 es casi igual (10, 11, 12); el 3 se parece menos (10, 13, 14, 15); el 4, nada (20).
  const datos = compras({ 1: { 10: 5, 11: 5 }, 2: { 10: 1, 11: 1, 12: 24 }, 3: { 10: 1, 13: 12, 14: 1, 15: 1 }, 4: { 20: 9 } });
  const vendible = new Set([10, 11, 12, 13, 14, 20]);

  it('lo que compran los parecidos y él no; el más parecido, primero', () => {
    const o = ofertaPara(new Set([1]), datos, vendible);
    expect(o).toMatchObject({ basadoEn: 'PARECIDOS', comparadoCon: 2, compraAsta: 2 });
    expect(o.productos.map((p) => p.productId)).toEqual([12, 13, 14]);
    // 24 unidades en 12 meses: 2 al mes.
    expect(o.productos[0]).toMatchObject({ clientes: 1, unidadesMes: 2 });
  });

  it('nunca lo que ya compra, ni lo que no se vende (el 15), ni lo de quien no se le parece (el 20)', () => {
    const ids = ofertaPara(new Set([1]), datos, vendible).productos.map((p) => p.productId);
    expect(ids).not.toContain(10);
    expect(ids).not.toContain(15);
    expect(ids).not.toContain(20);
  });

  it('sus contactos cuentan como él', () => {
    const conContacto = compras({ 1: { 10: 5 }, 5: { 11: 1 }, 2: { 10: 1, 11: 1, 12: 24 } });
    const o = ofertaPara(new Set([1, 5]), conContacto, vendible);
    expect(o.compraAsta).toBe(2);
    expect(o.productos.map((p) => p.productId)).toEqual([12]);
  });

  it(`sin compras de ASTA, los ${PRODUCTOS_OFERTA} más vendidos`, () => {
    const o = ofertaPara(new Set([99]), datos, vendible);
    expect(o).toMatchObject({ basadoEn: 'MAS_VENDIDOS', compraAsta: 0, comparadoCon: 4 });
    expect(o.productos[0]).toMatchObject({ productId: 10, clientes: 3 });
    expect(o.productos).toHaveLength(PRODUCTOS_OFERTA);
  });
});

describe('La ruta', () => {
  let server: Server;
  let base = '';
  const usuarios: string[] = [];
  const tokens = { vendedor: '', admin: '' };
  const INICIO = new Date();
  const AGENTE = 'asta-test-oferta';

  async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string, partner: number, odooUserId: number | null) {
    const u = await prisma.appUser.create({ data: { email: `test.oferta.${sufijo}@oferta.local`, fullName: `Oferta ${sufijo}`, role: rol, odooPartnerId: partner, odooUserId, isActive: true } });
    usuarios.push(u.id);
    const sesion = await prisma.userSession.create({
      data: { userId: u.id, refreshTokenHash: hashSecreto(`of-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
      select: { id: true },
    });
    return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId, sid: sesion.id });
  }

  const pedir = (ruta: string, quien: keyof typeof tokens) => fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });

  beforeAll(async () => {
    if (await prisma.appUser.count({ where: { email: { endsWith: '@oferta.local' } } })) throw new Error('Restos de @oferta.local: límpialos a mano.');
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const dir = server.address();
    if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
    base = `http://127.0.0.1:${dir.port}`;
    // Un vendedor que no existe en Odoo: su cartera está vacía.
    tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 3_880_000_001, 3_880_000);
    tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 3_880_000_002, null);
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

  it('el vendedor no la ve de un cliente que no es suyo', async () => {
    // Un cliente que existe en Odoo, de la cartera de otro: 403, no 404.
    expect((await pedir('/api/v1/salesperson/clients/133261/oferta', 'vendedor')).status).toBe(403);
  }, 60_000);

  it('administración la ve de cualquiera, con la forma del contrato', async () => {
    const res = await pedir('/api/v1/salesperson/clients/1/oferta', 'admin');
    expect(res.status).toBe(200);
    const o = ofertaClienteRespuestaSchema.parse(await res.json()).data;
    expect(o.productos.length).toBeLessThanOrEqual(PRODUCTOS_OFERTA);
  }, 120_000);
});
