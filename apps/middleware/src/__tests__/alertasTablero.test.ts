import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { UMBRALES_ALERTAS, alertasTableroRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';
import {
  caidaFrenteMedia,
  caidasSeguidas,
  concentracion,
  diaDelGrupo,
  diasHabiles,
  evaluarRitmo,
  hoyEnCaracas,
  semanasCompletas,
} from '../services/alertasTablero.service.js';

/*
 * Las alertas del tablero de ASTA, con los ejemplos del anexo de criterios.
 */

describe('alertas · días hábiles y semanas', () => {
  it('octubre de 2026 tiene 22 días hábiles; el 28 (miércoles) van 20', () => {
    expect(diasHabiles('2026-10-28')).toEqual({ transcurridos: 20, total: 22, restantes: 2 });
    expect(diasHabiles('2026-10-01')).toEqual({ transcurridos: 1, total: 22, restantes: 21 });
    // Un sábado cuenta lo mismo que el viernes anterior.
    expect(diasHabiles('2026-10-03').transcurridos).toBe(diasHabiles('2026-10-02').transcurridos);
  });

  it('el día es el de Caracas: las 23:00 del 31 allí son ya el 1 en UTC', () => {
    expect(hoyEnCaracas(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-31');
    expect(hoyEnCaracas(new Date('2026-11-01T04:00:00Z'))).toBe('2026-11-01');
  });

  it('las semanas completas son de lunes a domingo y no incluyen la de hoy', () => {
    const s = semanasCompletas('2026-10-28', 3);
    expect(s).toEqual([
      { desde: '2026-10-05', hasta: '2026-10-11' },
      { desde: '2026-10-12', hasta: '2026-10-18' },
      { desde: '2026-10-19', hasta: '2026-10-25' },
    ]);
    // Un lunes, la última completa es la que acabó ayer.
    expect(semanasCompletas('2026-10-26', 1)).toEqual([{ desde: '2026-10-19', hasta: '2026-10-25' }]);
  });

  it('el día de un grupo de Odoo sale de su rango, y la hora UTC se pasa a Caracas', () => {
    expect(diaDelGrupo({ __range: { 'invoice_date:day': { from: '2026-10-20' } } }, 'invoice_date')).toBe('2026-10-20');
    expect(diaDelGrupo({ __range: { 'create_date:day': { from: '2026-10-20 04:00:00' } } }, 'create_date')).toBe('2026-10-20');
    expect(diaDelGrupo({}, 'create_date')).toBeNull();
  });
});

describe('alertas · 1, ritmo proyectado', () => {
  const mitad = { transcurridos: 15, total: 30, restantes: 15 };

  it('el ejemplo del anexo: a mitad de mes, con el 38 % hecho, salta y dice cuánto acelerar', () => {
    const r = evaluarRitmo(1000, 380, mitad);
    expect(r.estado).toBe('advertencia');
    expect(r.proyeccion).toBe(760);
    expect(r.esperadoAHoy).toBe(500);
    // Faltan 620 en 15 días: 41,33 al día frente a 25,33 que se lleva.
    expect(r.ritmoNecesario).toBeCloseTo(41.33, 2);
    expect(r.aceleracion).toBeCloseTo(0.632, 3);
  });

  it('justo en el 90 % no salta; por debajo, sí', () => {
    expect(evaluarRitmo(1000, 450, mitad).estado).toBe('ok');
    expect(evaluarRitmo(1000, 449, mitad).estado).toBe('advertencia');
  });

  it('los primeros días no se juzga: el día 1 sin ventas proyecta cero', () => {
    const r = evaluarRitmo(1000, 0, { transcurridos: UMBRALES_ALERTAS.diasHabilesMinimos - 1, total: 22, restantes: 20 });
    expect(r.estado).toBe('pronto');
  });

  it('con el objetivo ya superado no hace falta acelerar', () => {
    const r = evaluarRitmo(1000, 1200, mitad);
    expect(r.ritmoNecesario).toBe(0);
    expect(r.aceleracion).toBeNull();
  });
});

describe('alertas · 2, concentración', () => {
  it('cuenta a los que son MENOS del 15 %: de 100 clientes, los 14 primeros', () => {
    const importes = [...Array(14).fill(50), ...Array(86).fill(5)];
    const r = concentracion(importes);
    expect(r.base).toBe(100);
    expect(r.primeros).toBe(14);
    // 700 de 1130.
    expect(r.parte).toBeCloseTo(0.619, 3);
    expect(r.dispara).toBe(true);
  });

  it('repartido, no salta; las devoluciones no son compradores', () => {
    const r = concentracion([...Array(20).fill(10), -50, 0]);
    expect(r.base).toBe(20);
    expect(r.dispara).toBe(false);
  });

  it('sin ventas no hay nada que concentrar', () => {
    expect(concentracion([])).toEqual({ base: 0, primeros: 0, parte: 0, dispara: false });
  });
});

describe('alertas · 3, tendencia temprana', () => {
  it('lo cotizado salta si cae un 15 % frente a la media de las cuatro semanas anteriores', () => {
    expect(caidaFrenteMedia([100, 100, 100, 100, 85]).dispara).toBe(true);
    expect(caidaFrenteMedia([100, 100, 100, 100, 86]).dispara).toBe(false);
    expect(caidaFrenteMedia([999, 100, 100, 100, 100, 50]).media).toBe(100);
  });

  it('sin cuatro semanas de historia no hay media', () => {
    expect(caidaFrenteMedia([100, 100, 50])).toMatchObject({ caida: null, dispara: false });
  });

  it('cuenta las caídas seguidas desde el final, y un hueco las corta', () => {
    expect(caidasSeguidas([0.9, 0.8, 0.7, 0.6])).toBe(3);
    expect(caidasSeguidas([0.9, 0.95, 0.8, 0.7])).toBe(2);
    expect(caidasSeguidas([0.9, null, 0.8, 0.7])).toBe(1);
    expect(caidasSeguidas([0.7, 0.7])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { admin: '', vendedor: '', cliente: '' };
const INICIO = new Date();
const AGENTE = 'asta-test-alertas';

async function pedir(quien: keyof typeof tokens) {
  const res = await fetch(`${base}/api/v1/admin/alertas`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string) {
  const partner = 3_870_000_000 + usuarios.length;
  const u = await prisma.appUser.create({ data: { email: `test.alertas.${sufijo}@alertas.local`, fullName: `Alertas ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`alertas-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@alertas.local' } } })) throw new Error('Restos de @alertas.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin');
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor');
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

describe('alertas · quién las ve', () => {
  it('el administrador, con la forma del contrato', async () => {
    const r = await pedir('admin');
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const valido = alertasTableroRespuestaSchema.safeParse(r.body);
    expect(valido.success, JSON.stringify(valido.error?.issues?.slice(0, 3))).toBe(true);
    expect(valido.data!.data.tendencia.semanas).toHaveLength(UMBRALES_ALERTAS.semanasVenta);
  }, 180_000);

  it('ni el vendedor ni el cliente', async () => {
    expect((await pedir('vendedor')).status).toBe(403);
    expect((await pedir('cliente')).status).toBe(403);
  });
});
