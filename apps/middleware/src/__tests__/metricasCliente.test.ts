import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { metricasClienteRespuestaSchema, type MetricasCliente } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';
import { periodoDeEtiqueta } from '../services/ventasAsta.service.js';

/**
 * «Mis métricas» del cliente (fase 1 del sell-out).
 *
 *   · solo un cliente las ve, y solo las suyas: el partner sale del token
 *   · cada bloque sale aunque otro falle, y con la forma del contrato
 *   · lo de las tablets cuenta SOLO las del cliente, no las de otros
 *
 * Partners inventados (3_840_000_000…): en Odoo no tienen compras, así que
 * compras y nivel salen vacíos; lo que se mira es la forma y el aislamiento.
 * Datos: tablets «ZZ Métricas …», que se borran al final.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tablets: string[] = [];
const tokens = { cliente: '', otro: '', vendedor: '', admin: '' };
const PARTNER = 3_840_000_001;
const OTRO = 3_840_000_002;
const INICIO = new Date();
const AGENTE = 'asta-test-metricas';

async function pedir<B>(ruta: string, quien: keyof typeof tokens) {
  const res = await fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });
  return { status: res.status, body: (await res.json().catch(() => null)) as B };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({
    data: { email: `test.metricas.${sufijo}@metricas.local`, fullName: `Métricas ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`met-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

async function tabletCon(partner: number, nombre: string, busquedas: Array<{ q: string; resultados: number }>) {
  const t = await prisma.kioskDevice.create({
    data: { label: nombre, storeLocation: 'Pruebas', odooPartnerId: partner, tokenHash: `${nombre}`.padEnd(64, '0').slice(0, 64) },
  });
  tablets.push(t.id);
  await prisma.recommendationEvent.createMany({
    data: busquedas.map((b) => ({ deviceId: t.id, searchQuery: b.q, resultsCount: b.resultados })),
  });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@metricas.local' } } })) throw new Error('Restos de @metricas.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente', PARTNER);
  tokens.otro = await usuarioConToken('BRONCE', 'otro', OTRO);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 3_840_000_003);
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 3_840_000_004);
  await tabletCon(PARTNER, 'ZZ Métricas mostrador', [
    { q: 'zzmet hl2350', resultados: 3 },
    { q: 'zzmet hl2350', resultados: 3 },
    { q: 'zzmet nada404', resultados: 0 },
  ]);
  await tabletCon(OTRO, 'ZZ Métricas ajena', [{ q: 'zzmet ajena', resultados: 0 }]);
}, 120_000);

afterAll(async () => {
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  if (tablets.length) {
    await prisma.recommendationEvent.deleteMany({ where: { deviceId: { in: tablets } } });
    await prisma.kioskDevice.deleteMany({ where: { id: { in: tablets } } });
  }
  if (usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('Mis métricas del cliente', () => {
  it('lee la etiqueta de mes de la serie del vendedor', () => {
    expect(periodoDeEtiqueta('mayo 2026')).toBe('2026-05');
    expect(periodoDeEtiqueta('diciembre 2025')).toBe('2025-12');
    expect(periodoDeEtiqueta('2026-05')).toBeNull();
  });

  it('el cliente las ve, con la forma del contrato y los últimos doce meses', async () => {
    const r = await pedir<{ data: MetricasCliente }>('/api/v1/account/metricas', 'cliente');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const valida = metricasClienteRespuestaSchema.safeParse(r.body);
    expect(valida.success, JSON.stringify(valida.error?.issues)).toBe(true);
    expect(r.body.data.periodo.hasta).toBe(new Date().toISOString().slice(0, 10));
    // Los doce meses, aunque no haya compras, en «AAAA-MM» y terminando en el actual.
    const serie = r.body.data.compras?.serieMensual ?? [];
    if (r.body.data.compras) {
      expect(serie).toHaveLength(12);
      expect(serie.at(-1)!.periodo).toBe(new Date().toISOString().slice(0, 7));
    }
  }, 120_000);

  it('su programa: sin compras este trimestre, Cliente general medido contra Bronce, sin tokens', async () => {
    const r = await pedir<{ data: MetricasCliente }>('/api/v1/account/metricas', 'cliente');
    expect(r.body.data.programa).toMatchObject({ saldoTokens: 0, evaluacion: { nivel: 'GENERAL', cuotaMensual: 250, compraTrimestre: 0 } });
    expect(r.body.data.programa!.evaluacion.meses).toHaveLength(3);
  }, 120_000);

  it('sus tablets cuentan solo lo suyo', async () => {
    const r = await pedir<{ data: MetricasCliente }>('/api/v1/account/metricas', 'cliente');
    expect(r.body.data.tablets).toMatchObject({ cuantas: 1, busquedas: 3, sinResultado: 1 });
    expect(r.body.data.tablets!.sinEncontrar.map((s) => s.texto)).toEqual(['zzmet nada404']);

    const otro = await pedir<{ data: MetricasCliente }>('/api/v1/account/metricas', 'otro');
    expect(otro.body.data.tablets).toMatchObject({ cuantas: 1, busquedas: 1, sinResultado: 1 });
    expect(otro.body.data.tablets!.sinEncontrar.map((s) => s.texto)).toEqual(['zzmet ajena']);
  }, 120_000);

  it('sin tablets, el bloque de tablets no sale', async () => {
    await prisma.kioskDevice.updateMany({ where: { id: { in: tablets }, odooPartnerId: OTRO }, data: { odooPartnerId: 3_840_000_099 } });
    const r = await pedir<{ data: MetricasCliente }>('/api/v1/account/metricas', 'otro');
    expect(r.body.data.tablets).toBeNull();
  }, 120_000);

  it('el personal no tiene «Mis métricas»: 403', async () => {
    expect((await pedir('/api/v1/account/metricas', 'vendedor')).status).toBe(403);
    expect((await pedir('/api/v1/account/metricas', 'admin')).status).toBe(403);
  });
});
