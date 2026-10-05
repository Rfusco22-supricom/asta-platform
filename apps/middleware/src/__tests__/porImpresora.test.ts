import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import {
  busquedaCartuchosRespuestaSchema,
  guardarTonersRespuestaSchema,
  porImpresoraRespuestaSchema,
  type BusquedaCartuchosRespuesta,
  type GuardarTonersRespuesta,
  type ImpresoraConToners,
  type PorImpresoraRespuesta,
} from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { vaciarCachesRevision } from '../services/recomendador/revision.service.js';
import { resumenLoteFabricante, validarLoteFabricante } from '../services/recomendador/porImpresora.service.js';

/**
 * «Impresora | Tóners compatibles»: la pestaña Impresoras vista desde la impresora.
 *
 * Lo que se vigila:
 *
 *   · cada impresora sale en su vista: por revisar, sin tóner o lista
 *   · guardar deja EXACTAMENTE lo marcado: lo marcado VALIDADO, lo propuesto o
 *     validado sin marcar RECHAZADO, lo rechazado sin marcar como estaba
 *   · un tóner que falta se crea al guardar, y si ya existía no se duplica
 *   · si la base cambió desde que se cargó la pantalla, 409 y no se toca nada
 *   · solo el administrador
 *
 * Datos: marca `ZZ_PORIMP` e impresoras/tóners `ZZ*` que no existen.
 */

const MARCA = 'ZZ_PORIMP';

let server: Server;
let base = '';
let comprobado = false;
const usuarios: string[] = [];
const eventos: AuditEvent[] = [];
const tokens = { admin: '', vendedor: '' };
let marcaId = 0;
const impresora: Record<string, number> = {};
const toner: Record<string, number> = {};

async function pedir<B>(metodo: 'GET' | 'PUT', ruta: string, quien: keyof typeof tokens, cuerpo?: unknown) {
  const res = await fetch(`${base}/api/v1${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokens[quien]}`, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json()) as B };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string) {
  const u = await prisma.appUser.create({
    data: { email: `test.porimp.${sufijo}@porimpresora.local`, fullName: `Por impresora ${sufijo}`, role: rol, odooPartnerId: 3_810_000_000 + usuarios.length, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`porimp-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

const listar = (vista: string) => pedir<PorImpresoraRespuesta>('GET', `/admin/compatibilidades/por-impresora?marca=${MARCA}&vista=${vista}`, 'admin');
const vistos = (i: ImpresoraConToners) => i.toners.map((t) => ({ cartridgeId: t.cartridgeId, estado: t.estado }));
const estados = async (printerModelId: number) =>
  Object.fromEntries(
    (await prisma.cartridgePrinterModel.findMany({ where: { printerModelId }, include: { cartridge: true } })).map((f) => [f.cartridge.code, f.status]),
  );

beforeAll(async () => {
  const restos = (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.appUser.count({ where: { email: { endsWith: '@porimpresora.local' } } }));
  if (restos) throw new Error(`Restos de ${MARCA} en la base: límpialos a mano.`);
  comprobado = true;

  registerAuditSink((e) => eventos.push(e));
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin');
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor');

  marcaId = (await prisma.printerBrand.create({ data: { name: MARCA } })).id;
  for (const nombre of ['ZZJet 500', 'ZZJet 501', 'ZZJet 502']) {
    impresora[nombre] = (await prisma.printerModel.create({ data: { brandId: marcaId, name: nombre, nameNormalized: nombre.toLowerCase().replace(/\s/g, '') } })).id;
  }
  for (const codigo of ['ZZT-1', 'ZZT-2', 'ZZT-3', 'ZZT-4']) {
    toner[codigo] = (await prisma.cartridge.create({ data: { brandId: marcaId, code: codigo, codeNormalized: codigo.toLowerCase().replace(/-/g, ''), kind: 'TONER' } })).id;
  }
  const enlazar = (codigo: string, nombre: string, status: 'PROPUESTA' | 'VALIDADA' | 'RECHAZADA') =>
    prisma.cartridgePrinterModel.create({ data: { cartridgeId: toner[codigo]!, printerModelId: impresora[nombre]!, source: 'FABRICANTE', status } });
  // 500: por revisar, con uno de cada estado. 501: lista. 502: sin tóner.
  await enlazar('ZZT-1', 'ZZJet 500', 'PROPUESTA');
  await enlazar('ZZT-2', 'ZZJet 500', 'VALIDADA');
  await enlazar('ZZT-3', 'ZZJet 500', 'RECHAZADA');
  await enlazar('ZZT-1', 'ZZJet 501', 'VALIDADA');
  vaciarCachesRevision();
}, 120_000);

afterAll(async () => {
  if (comprobado) {
    await prisma.cartridge.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    if (usuarios.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
      await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
    }
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('Por impresora · listado', () => {
  it('un vendedor no entra: 403', async () => {
    expect((await pedir('GET', '/admin/compatibilidades/por-impresora', 'vendedor')).status).toBe(403);
    expect((await pedir('PUT', `/admin/compatibilidades/por-impresora/${impresora['ZZJet 502']}`, 'vendedor', { vistos: [], compatibles: [], nuevos: [] })).status).toBe(403);
  });

  it('cada impresora en su vista, con todos sus tóners', async () => {
    const r = await listar('todas');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(porImpresoraRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.meta.porVista).toEqual({ por_revisar: 1, sin_toner: 1, listas: 1, todas: 3 });

    const porRevisar = await listar('por_revisar');
    expect(porRevisar.body.data.map((i) => i.nombre)).toEqual(['ZZJet 500']);
    expect(porRevisar.body.data[0]!.toners.map((t) => [t.codigo, t.estado])).toEqual([
      ['ZZT-1', 'PROPUESTA'],
      ['ZZT-2', 'VALIDADA'],
      ['ZZT-3', 'RECHAZADA'],
    ]);
    expect((await listar('sin_toner')).body.data.map((i) => i.nombre)).toEqual(['ZZJet 502']);
    expect((await listar('listas')).body.data.map((i) => i.nombre)).toEqual(['ZZJet 501']);
  });

  it('se encuentra por el código de uno de sus tóners', async () => {
    const r = await pedir<PorImpresoraRespuesta>('GET', `/admin/compatibilidades/por-impresora?vista=todas&q=zzt-2`, 'admin');
    expect(r.body.data.map((i) => i.nombre)).toEqual(['ZZJet 500']);
  });

  it('el selector busca tóners por código, los que empiezan así primero', async () => {
    const r = await pedir<BusquedaCartuchosRespuesta>('GET', '/admin/compatibilidades/cartuchos?q=zzt', 'admin');
    expect(r.status).toBe(200);
    expect(busquedaCartuchosRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data.map((c) => c.codigo).slice(0, 4)).toEqual(['ZZT-1', 'ZZT-2', 'ZZT-3', 'ZZT-4']);
  });
});

describe('Por impresora · guardar', () => {
  it('deja exactamente lo marcado: valida, rechaza lo no marcado y añade', async () => {
    const [i] = (await listar('por_revisar')).body.data;
    // Marca la propuesta ZZT-1 y un tóner que no estaba (ZZT-4). La validada ZZT-2 no se marca.
    const r = await pedir<GuardarTonersRespuesta>('PUT', `/admin/compatibilidades/por-impresora/${i!.printerModelId}`, 'admin', {
      vistos: vistos(i!),
      compatibles: [toner['ZZT-1'], toner['ZZT-4']],
      nuevos: [],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(guardarTonersRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect([r.body.data.validadas, r.body.data.rechazadas]).toEqual([2, 1]);
    expect(await estados(i!.printerModelId)).toEqual({ 'ZZT-1': 'VALIDADA', 'ZZT-2': 'RECHAZADA', 'ZZT-3': 'RECHAZADA', 'ZZT-4': 'VALIDADA' });
    // La respuesta trae la impresora ya como queda, para pintarla sin recargar.
    expect(r.body.data.impresora.toners.filter((t) => t.estado === 'VALIDADA').map((t) => t.codigo)).toEqual(['ZZT-1', 'ZZT-4']);

    const auditoria = eventos.find((e) => e.action === 'compatibilidad.revisada' && e.targetId === String(i!.printerModelId));
    expect(auditoria?.metadata).toEqual({ validados: ['ZZT-1', 'ZZT-4'], rechazados: ['ZZT-2'], creados: [] });
  });

  it('un tóner que falta se crea al guardar; si ya existía, no se duplica', async () => {
    const id = impresora['ZZJet 502']!;
    const r = await pedir<GuardarTonersRespuesta>('PUT', `/admin/compatibilidades/por-impresora/${id}`, 'admin', {
      vistos: [],
      compatibles: [],
      nuevos: [
        { marca: MARCA, codigo: 'ZZT-9', tipo: 'TONER' },
        { marca: MARCA, codigo: 'zzt 3', tipo: 'TONER' },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.cartuchosNuevos).toBe(1);
    expect(await estados(id)).toEqual({ 'ZZT-3': 'VALIDADA', 'ZZT-9': 'VALIDADA' });
    const creado = await prisma.cartridgePrinterModel.findFirst({ where: { printerModelId: id, cartridge: { code: 'ZZT-9' } } });
    expect([creado?.source, creado?.reviewedBy !== null, creado?.createdBy !== null]).toEqual(['MANUAL', true, true]);
  });

  it('si la base cambió desde que se cargó, 409 y no se toca nada', async () => {
    const [i] = (await listar('listas')).body.data.filter((x) => x.nombre === 'ZZJet 501');
    // Mientras se miraba, un importador propone otro tóner.
    await prisma.cartridgePrinterModel.create({ data: { cartridgeId: toner['ZZT-2']!, printerModelId: i!.printerModelId, source: 'PARSEO', status: 'PROPUESTA' } });
    const antes = await estados(i!.printerModelId);
    const r = await pedir('PUT', `/admin/compatibilidades/por-impresora/${i!.printerModelId}`, 'admin', { vistos: vistos(i!), compatibles: [], nuevos: [] });
    expect(r.status).toBe(409);
    expect(await estados(i!.printerModelId)).toEqual(antes);
  });

  it('un tóner que no existe, 400', async () => {
    const id = impresora['ZZJet 502']!;
    const [i] = (await pedir<PorImpresoraRespuesta>('GET', `/admin/compatibilidades/por-impresora?vista=todas&q=zzjet502`, 'admin')).body.data;
    const r = await pedir('PUT', `/admin/compatibilidades/por-impresora/${id}`, 'admin', { vistos: vistos(i!), compatibles: [4_000_000_000], nuevos: [] });
    expect(r.status).toBe(400);
  });
});

describe('En lote: lo de las listas oficiales del fabricante', () => {
  let impresoraLote = 0;
  beforeAll(async () => {
    impresoraLote = (await prisma.printerModel.create({ data: { brandId: marcaId, name: 'ZZJet 600', nameNormalized: 'zzjet600' } })).id;
    const fila = (cartridgeId: number, source: 'FABRICANTE' | 'PARSEO', status: 'PROPUESTA' | 'RECHAZADA') =>
      prisma.cartridgePrinterModel.create({ data: { cartridgeId, printerModelId: impresoraLote, source, sourceRef: source === 'FABRICANTE' ? 'https://ejemplo.test/lista' : null, status } });
    await fila(toner['ZZT-1']!, 'FABRICANTE', 'PROPUESTA');
    await fila(toner['ZZT-2']!, 'FABRICANTE', 'PROPUESTA');
    // De otra fuente: no entra en el lote.
    await fila(toner['ZZT-3']!, 'PARSEO', 'PROPUESTA');
    // Rechazado: se queda rechazado.
    await fila(toner['ZZT-4']!, 'FABRICANTE', 'RECHAZADA');
  });

  it('el resumen cuenta solo lo pendiente de listas oficiales', async () => {
    expect(await resumenLoteFabricante(marcaId)).toEqual({ propuestas: 2, impresoras: 1, cartuchos: 2, fuentes: ['https://ejemplo.test/lista'] });
  });

  it('un vendedor no lo ve ni lo aplica: 403', async () => {
    expect((await pedir('GET', '/admin/compatibilidades/lote-fabricante', 'vendedor')).status).toBe(403);
  });

  it('con otra cifra que la vista, 409 y no se valida nada', async () => {
    const admin = await prisma.appUser.findFirstOrThrow({ where: { email: 'test.porimp.admin@porimpresora.local' } });
    await expect(validarLoteFabricante(3, admin.id, marcaId)).rejects.toThrow();
    expect((await resumenLoteFabricante(marcaId)).propuestas).toBe(2);
  });

  it('valida lo oficial y deja lo demás como estaba', async () => {
    const admin = await prisma.appUser.findFirstOrThrow({ where: { email: 'test.porimp.admin@porimpresora.local' } });
    expect(await validarLoteFabricante(2, admin.id, marcaId)).toEqual({ validadas: 2 });
    expect(await estados(impresoraLote)).toEqual({ 'ZZT-1': 'VALIDADA', 'ZZT-2': 'VALIDADA', 'ZZT-3': 'PROPUESTA', 'ZZT-4': 'RECHAZADA' });
    const fila = await prisma.cartridgePrinterModel.findFirstOrThrow({ where: { printerModelId: impresoraLote, cartridgeId: toner['ZZT-1']! } });
    expect([fila.reviewedBy, fila.reviewedAt !== null]).toEqual([admin.id, true]);
  });
});
