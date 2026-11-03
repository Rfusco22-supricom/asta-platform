import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { demandaAstaRespuestaSchema, type ImpresoraDemandada } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { cartuchosQueFaltan, clasificar } from '../services/recomendador/demanda.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * La demanda no cubierta de ASTA.
 *
 *   · cada impresora buscada, en un estado: cubierta, por validar, sin ASTA o sin datos
 *   · los cartuchos que faltan suman las búsquedas de las impresoras sin ASTA que los usan
 *   · solo administración
 */

describe('Clasificar una impresora', () => {
  const asta = new Set([10, 11]);

  it('cubierta con un producto ASTA validado, aunque haya otros', () => {
    expect(clasificar({ cartuchos: ['CF258X'], validadas: [99, 10], propuestas: [] }, asta)).toBe('CUBIERTA');
  });

  it('por validar si el de ASTA solo está propuesto', () => {
    expect(clasificar({ cartuchos: ['CF258X'], validadas: [99], propuestas: [11] }, asta)).toBe('POR_VALIDAR');
  });

  it('sin ASTA si se saben sus cartuchos y solo hay otras marcas', () => {
    expect(clasificar({ cartuchos: ['CF258X'], validadas: [99], propuestas: [98] }, asta)).toBe('SIN_ASTA');
  });

  it('sin datos si ni siquiera se sabe qué cartucho usa', () => {
    expect(clasificar({ cartuchos: [], validadas: [], propuestas: [] }, asta)).toBe('SIN_DATOS');
  });
});

describe('Los cartuchos que faltan', () => {
  const impresora = (nombre: string, estado: ImpresoraDemandada['estado'], busquedas: number, cartuchos: string[]): ImpresoraDemandada => ({
    printerModelId: busquedas,
    marca: 'HP',
    nombre,
    estado,
    busquedas,
    tablets: 1,
    ultimaVez: '2026-11-01T00:00:00.000Z',
    cartuchos,
  });

  it('suman las búsquedas de las impresoras SIN_ASTA que los usan; las demás no cuentan', () => {
    const r = cartuchosQueFaltan(
      [impresora('M404', 'SIN_ASTA', 7, ['CF258A', 'CF258X']), impresora('M428', 'SIN_ASTA', 5, ['CF258X']), impresora('P1102', 'POR_VALIDAR', 40, ['CE285A'])],
      new Map([['CF258X', 'HP']]),
    );
    expect(r.map((c) => [c.codigo, c.busquedas, c.impresoras.length])).toEqual([
      ['CF258X', 12, 2],
      ['CF258A', 7, 1],
    ]);
    expect(r[0]!.marca).toBe('HP');
  });
});

describe('La ruta', () => {
  let server: Server;
  let base = '';
  const usuarios: string[] = [];
  const tokens = { vendedor: '', admin: '' };
  const INICIO = new Date();
  const AGENTE = 'asta-test-demanda';

  async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string, partner: number) {
    const u = await prisma.appUser.create({ data: { email: `test.demanda.${sufijo}@demanda.local`, fullName: `Demanda ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
    usuarios.push(u.id);
    const sesion = await prisma.userSession.create({
      data: { userId: u.id, refreshTokenHash: hashSecreto(`dm-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
      select: { id: true },
    });
    return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
  }

  const pedir = (ruta: string, quien: keyof typeof tokens) => fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });

  beforeAll(async () => {
    if (await prisma.appUser.count({ where: { email: { endsWith: '@demanda.local' } } })) throw new Error('Restos de @demanda.local: límpialos a mano.');
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const dir = server.address();
    if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
    base = `http://127.0.0.1:${dir.port}`;
    tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 3_870_000_001);
    tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 3_870_000_002);
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

  it('el vendedor no la ve', async () => {
    expect((await pedir('/api/v1/admin/demanda', 'vendedor')).status).toBe(403);
  });

  it('administración la ve, y los totales cuadran', async () => {
    const res = await pedir('/api/v1/admin/demanda?desde=2026-01-01&hasta=2026-12-31&sede=9', 'admin');
    expect(res.status).toBe(200);
    const { totales } = demandaAstaRespuestaSchema.parse(await res.json()).data;
    expect(totales.cubiertas + totales.porValidar + totales.sinAsta + totales.sinDatos).toBe(totales.conImpresora);
  }, 60_000);
});
