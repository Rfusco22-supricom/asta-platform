import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema, estadisticasRecomendadorRespuestaSchema, type EstadisticasRecomendador } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';

/**
 * #43 · Estadísticas del recomendador para el panel, contra servidor y MySQL.
 *
 * ── Aislado por fecha ────────────────────────────────────────────────────────
 *
 * Las filas se siembran con fechas de MARZO DE 2020 y se consulta solo ese mes.
 * Ninguna búsqueda real cae ahí —la telemetría empezó en 2026—, así que los
 * totales son exactamente los de este fichero, y el test lo comprueba antes de
 * sembrar. Se borran al terminar por esas mismas fechas.
 */

const MES = { desde: '2020-03-01', hasta: '2020-03-31' };
const MARCA = 'ZZ_EST_MARCA';
const d = (dia: number, hora = 12) => new Date(Date.UTC(2020, 2, dia, hora));

let server: Server;
let base = '';
let comprobado = false;
const usuarios: string[] = [];
const tokens = { admin: '', vendedor: '' };
const P = { a: 0, b: 0 };
let productos: Array<{ id: number; name: string; default_code: string | false }> = [];

async function get<T>(ruta: string, quien: keyof typeof tokens) {
  const res = await fetch(`${base}/api/v1${ruta}`, { headers: { Authorization: `Bearer ${tokens[quien]}` } });
  return { status: res.status, body: (await res.json()) as T };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({
    data: { email: `test.est.${sufijo}@estadisticas.local`, fullName: `Estadísticas ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true },
  });
  usuarios.push(u.id);
  const s = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`est-${u.id}-${Math.random()}`), expiresAt: caducaEnDias(1) },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: s.id });
}

beforeAll(async () => {
  const enElMes = await prisma.recommendationEvent.count({ where: { createdAt: { gte: d(1, 0), lt: new Date(Date.UTC(2020, 3, 1)) } } });
  const restos = (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.appUser.count({ where: { email: { endsWith: '@estadisticas.local' } } }));
  if (enElMes || restos) throw new Error('Ya hay telemetría de marzo de 2020 o restos de este test: límpialos a mano.');
  comprobado = true;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 3_920_000_001);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 3_920_000_002);

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const crear = (name: string) => prisma.printerModel.create({ data: { brandId: marca.id, name, nameNormalized: name.toLowerCase().replace(/[^a-z0-9]/g, '') } });
  P.a = (await crear('ZZ-Est 1001')).id;
  P.b = (await crear('ZZ-Est 2002')).id;

  // Dos productos reales, para comprobar que el nombre sale de Odoo.
  productos = await searchRead('product.product', [['sale_ok', '=', true], ['default_code', '!=', false]], ['name', 'default_code'], { limit: 2, order: 'id' });
  if (productos.length < 2) throw new Error('Hacen falta dos productos con referencia.');
  const [x, y] = productos.map((p) => p.id);

  const u = usuarios[0];
  await prisma.recommendationEvent.createMany({
    data: [
      // Sin resultado: tres formas de la misma búsqueda, más otra distinta.
      { userId: u, searchQuery: 'HL-2350', resultsCount: 0, createdAt: d(2) },
      { userId: u, searchQuery: 'HL-2350', resultsCount: 0, createdAt: d(3) },
      { userId: u, searchQuery: 'hl 2350 ', resultsCount: 0, createdAt: d(20) },
      { userId: u, searchQuery: 'epson l999', resultsCount: 0, createdAt: d(4) },
      // El último minuto del mes cuenta: `hasta` es un día entero, incluido.
      { userId: u, searchQuery: 'Epson L999', resultsCount: 0, createdAt: new Date(Date.UTC(2020, 2, 31, 23, 59)) },
      // Con impresora: A tres veces (una con quiebre), B una.
      { userId: u, searchQuery: 'zz est 1001', resultsCount: 1, matchedPrinterId: P.a, clickedProductId: x, createdAt: d(5) },
      { userId: u, searchQuery: 'zz est', resultsCount: 2, matchedPrinterId: P.a, clickedProductId: x, createdAt: d(6) },
      { userId: u, searchQuery: 'zzest1001', resultsCount: 1, matchedPrinterId: P.a, wasOutOfStock: true, createdAt: d(7) },
      { userId: u, searchQuery: 'zz est 2002', resultsCount: 1, matchedPrinterId: P.b, clickedProductId: y, createdAt: d(8) },
      // Consulta directa con quiebre: cuenta en impresoras y quiebres, no en búsquedas.
      { userId: u, searchQuery: '', matchedPrinterId: P.b, wasOutOfStock: true, createdAt: d(9) },
      // Fuera del mes: no cuentan.
      { userId: u, searchQuery: 'HL-2350', resultsCount: 0, createdAt: new Date(Date.UTC(2020, 1, 29, 23, 59)) },
      { userId: u, searchQuery: 'HL-2350', resultsCount: 0, createdAt: new Date(Date.UTC(2020, 3, 1, 0, 0)) },
    ],
  });
}, 60_000);

afterAll(async () => {
  if (comprobado) {
    await prisma.recommendationEvent.deleteMany({ where: { createdAt: { gte: new Date(Date.UTC(2020, 1, 1)), lt: new Date(Date.UTC(2020, 4, 1)) } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#43 · Estadísticas del recomendador', () => {
  let e: EstadisticasRecomendador;

  beforeAll(async () => {
    const r = await get<{ data: EstadisticasRecomendador }>(`/admin/recomendador/estadisticas?desde=${MES.desde}&hasta=${MES.hasta}`, 'admin');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(estadisticasRecomendadorRespuestaSchema.safeParse(r.body).success).toBe(true);
    e = r.body.data;
  });

  it('los totales, con los bordes del mes excluidos', () => {
    expect(e.totales).toEqual({ busquedas: 9, sinResultado: 5, conImpresora: 4, conClic: 3, quiebres: 2, consultasDirectas: 1 });
  });

  it('las búsquedas sin resultado se agrupan por forma normalizada, con el texto más frecuente de ejemplo', () => {
    expect(e.sinResultado).toEqual([
      { normalizada: 'hl2350', ejemplo: 'HL-2350', variantes: 2, veces: 3, ultimaVez: d(20).toISOString() },
      // "epson l999" y "Epson L999" solo difieren en mayúsculas, y la colación
      // de MySQL las junta ya al agrupar: una variante, con uno de los dos textos.
      { normalizada: 'epsonl999', ejemplo: expect.stringMatching(/^epson l999$/i), variantes: 1, veces: 2, ultimaVez: new Date(Date.UTC(2020, 2, 31, 23, 59)).toISOString() },
    ]);
  });

  it('las impresoras más buscadas, con sus quiebres, incluida la consulta directa', () => {
    expect(e.impresoras).toEqual([
      { printerModelId: P.a, marca: MARCA, nombre: 'ZZ-Est 1001', veces: 3, quiebres: 1 },
      { printerModelId: P.b, marca: MARCA, nombre: 'ZZ-Est 2002', veces: 2, quiebres: 1 },
    ]);
  });

  it('los productos más pulsados, con su nombre de Odoo', () => {
    const [x, y] = productos;
    expect(e.productos).toEqual([
      { productId: x.id, nombre: x.name, sku: x.default_code || null, clics: 2 },
      { productId: y.id, nombre: y.name, sku: y.default_code || null, clics: 1 },
    ]);
  });
});

describe('#43 · Quién y con qué rango', () => {
  it('un VENDEDOR no puede verlas: 403', async () => {
    const r = await get<unknown>('/admin/recomendador/estadisticas', 'vendedor');
    expect(r.status).toBe(403);
  });

  it('un rango inválido es 400 INVALID_DATE_RANGE, no un 500', async () => {
    for (const q of ['desde=2020-02-31&hasta=2020-03-31', 'desde=2020-03-01', 'desde=2020-04-01&hasta=2020-03-01']) {
      const r = await get<unknown>(`/admin/recomendador/estadisticas?${q}`, 'admin');
      expect(r.status, q).toBe(400);
      expect(apiErrorSchema.parse(r.body).error.code).toBe('INVALID_DATE_RANGE');
    }
  });

  it('y lo mismo en /admin/reportes, que compartía el fallo', async () => {
    // RangoInvalido no tenía `status`: errorHandler lo servía como 500.
    const r = await get<unknown>('/admin/reportes?desde=2020-02-31&hasta=2020-03-31', 'admin');
    expect(r.status).toBe(400);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('INVALID_DATE_RANGE');
  });

  it('un mes sin telemetría devuelve ceros y listas vacías', async () => {
    const r = await get<{ data: EstadisticasRecomendador }>('/admin/recomendador/estadisticas?desde=2019-01-01&hasta=2019-01-31', 'admin');
    expect(r.status).toBe(200);
    expect(r.body.data.totales).toEqual({ busquedas: 0, sinResultado: 0, conImpresora: 0, conClic: 0, quiebres: 0, consultasDirectas: 0 });
    expect([r.body.data.sinResultado, r.body.data.impresoras, r.body.data.productos]).toEqual([[], [], []]);
  });
});
