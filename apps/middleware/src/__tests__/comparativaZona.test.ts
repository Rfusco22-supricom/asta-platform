import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { MIN_CLIENTES_ZONA, comparativaZonaSchema, porcentajeArriba } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { compararCon, cuantil, zonaDe, type CompraCliente, type TablaZonas } from '../services/comparativaZona.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * «Tú frente a tu zona».
 *
 *   · la zona es el estado, sin país ni acentos (fichas con el país mal elegido)
 *   · su puesto, el cliente típico y desde cuánto se está arriba
 *   · un estado con pocos clientes no se enseña: va con el país
 *   · quien no compró no tiene puesto, pero sí con quién compararse
 *   · el personal no tiene comparativa
 */

describe('La zona', () => {
  it('el estado sin el país', () => {
    expect(zonaDe('Carabobo (VE)')).toEqual({ clave: 'carabobo', nombre: 'Carabobo', deVenezuela: true });
  });

  it('el Bolívar de Ecuador es el de aquí', () => {
    expect(zonaDe('Bolivar (EC)')!.clave).toBe(zonaDe('Bolívar (VE)')!.clave);
    expect(zonaDe('Bolivar (EC)')!.deVenezuela).toBe(false);
  });

  it('sin estado no hay zona', () => {
    expect(zonaDe(false)).toBeNull();
    expect(zonaDe(null)).toBeNull();
    expect(zonaDe('  ')).toBeNull();
  });
});

describe('Las cuentas', () => {
  it('cuantil, interpolando', () => {
    expect(cuantil([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(cuantil([10, 20, 30, 40, 50], 0.75)).toBe(40);
    expect(cuantil([], 0.5)).toBe(0);
  });

  it('el «top X %» siempre hacia arriba, entre 1 y 100', () => {
    expect(porcentajeArriba(1, 162)).toBe(1);
    expect(porcentajeArriba(19, 453)).toBe(5);
    expect(porcentajeArriba(162, 162)).toBe(100);
  });
});

describe('La comparativa', () => {
  const c = (compras: number, zona: string | null, referencias = 1, meses = 1): CompraCliente => ({ compras, referencias, meses, zona });

  // Seis en Carabobo (1–6), dos en Apure (7–8), uno sin estado (9).
  const tabla: TablaZonas = {
    clientes: new Map([
      [1, c(100, 'carabobo', 2, 1)],
      [2, c(200, 'carabobo', 3, 2)],
      [3, c(300, 'carabobo', 4, 3)],
      [4, c(400, 'carabobo', 5, 4)],
      [5, c(500, 'carabobo', 6, 5)],
      [6, c(600, 'carabobo', 7, 6)],
      [7, c(1000, 'apure')],
      [8, c(50, 'apure')],
      [9, c(700, null)],
    ]),
    nombres: new Map([
      ['carabobo', 'Carabobo'],
      ['apure', 'Apure'],
    ]),
  };

  it('su puesto y las cifras de su estado', () => {
    const r = compararCon(tabla, 4, 'Carabobo (VE)');
    expect(r.estado).toBe('Carabobo');
    expect(r.zona).toMatchObject({ ambito: 'ZONA', nombre: 'Carabobo', clientes: 6, puesto: 3 });
    expect(r.zona!.compras).toEqual({ tuyo: 400, tipico: 350, parteAlta: 475 });
    expect(r.zona!.referencias.tuyo).toBe(5);
    expect(r.pais).toMatchObject({ ambito: 'PAIS', clientes: 9, puesto: 5 });
  });

  it(`con menos de ${MIN_CLIENTES_ZONA} clientes en su estado, solo el país`, () => {
    const r = compararCon(tabla, 7, 'Apure (VE)');
    expect(r.estado).toBe('Apure');
    expect(r.zona).toBeNull();
    expect(r.pais!.puesto).toBe(1);
  });

  it('quien no compró no tiene puesto, y su estado cuenta igual', () => {
    const r = compararCon(tabla, 99, 'Carabobo (VE)');
    expect(r.zona!.puesto).toBeNull();
    expect(r.zona!.compras.tuyo).toBe(0);
    expect(r.zona!.clientes).toBe(6);
  });

  it('sin estado en su ficha, solo el país', () => {
    const r = compararCon(tabla, 9, null);
    expect(r.estado).toBeNull();
    expect(r.zona).toBeNull();
    expect(r.pais!.puesto).toBe(2);
  });

  it('los empates comparten puesto', () => {
    const empate: TablaZonas = { ...tabla, clientes: new Map([...tabla.clientes, [10, c(400, 'carabobo')]]) };
    expect(compararCon(empate, 4, 'Carabobo (VE)').zona!.puesto).toBe(3);
    expect(compararCon(empate, 10, 'Carabobo (VE)').zona!.puesto).toBe(3);
  });

  it('sin nadie que compre, no hay país', () => {
    expect(compararCon({ clientes: new Map(), nombres: new Map() }, 1, null).pais).toBeNull();
  });
});

describe('La ruta', () => {
  let server: Server;
  let base = '';
  const usuarios: string[] = [];
  const tokens = { cliente: '', vendedor: '' };
  const INICIO = new Date();
  const AGENTE = 'asta-test-zona';

  async function usuarioConToken(rol: 'BRONCE' | 'VENDEDOR', sufijo: string, partner: number) {
    const u = await prisma.appUser.create({ data: { email: `test.zona.${sufijo}@zona.local`, fullName: `Zona ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
    usuarios.push(u.id);
    const sesion = await prisma.userSession.create({
      data: { userId: u.id, refreshTokenHash: hashSecreto(`zo-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
      select: { id: true },
    });
    return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
  }

  const pedir = (ruta: string, quien: keyof typeof tokens) => fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });

  beforeAll(async () => {
    if (await prisma.appUser.count({ where: { email: { endsWith: '@zona.local' } } })) throw new Error('Restos de @zona.local: límpialos a mano.');
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const dir = server.address();
    if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
    base = `http://127.0.0.1:${dir.port}`;
    // Partner inventado: cabe en el entero de Odoo y no existe, así que no tiene estado ni compras.
    tokens.cliente = await usuarioConToken('BRONCE', 'cliente', 2_000_000_007);
    tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 2_000_000_008);
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

  it('un cliente sin estado ni compras: sin puesto, con el país', async () => {
    const res = await pedir('/api/v1/account/zona', 'cliente');
    expect(res.status).toBe(200);
    const c = comparativaZonaSchema.parse(((await res.json()) as { data: unknown }).data);
    expect(c.estado).toBeNull();
    expect(c.zona).toBeNull();
    expect(c.pais?.puesto ?? null).toBeNull();
  }, 120_000);

  it('el personal no tiene comparativa', async () => {
    expect((await pedir('/api/v1/account/zona', 'vendedor')).status).toBe(403);
  });
});
