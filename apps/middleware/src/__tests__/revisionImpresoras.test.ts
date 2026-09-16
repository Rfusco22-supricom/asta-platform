import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema, nuevaCompatibilidadRespuestaSchema, propuestasPropiasRespuestaSchema, revisionImpresorasRespuestaSchema, type RevisionImpresorasRespuesta } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { vaciarCachesRevision } from '../services/recomendador/revision.service.js';

/**
 * #56 · Tramo impresora → cartucho en el panel: revisar y AÑADIR.
 *
 * Lo que se vigila:
 *
 *   · lo que añade un administrador nace VALIDADO; lo de un vendedor, PROPUESTO,
 *     y la ruta del vendedor no tiene forma de conseguir otra cosa
 *   · volver a proponer algo que existe no lo cambia: un vendedor no puede
 *     devolver a pendiente lo validado ni reabrir lo rechazado
 *   · un vendedor solo ve sus propuestas
 *   · la revisión es todo o nada, como la de productos
 *
 * Datos: marca `ZZ_IMPR` y cartuchos/impresoras `ZZ*` que no existen.
 */

const MARCA = 'ZZ_IMPR';

let server: Server;
let base = '';
let comprobado = false;
const usuarios: string[] = [];
const eventos: AuditEvent[] = [];
const tokens: Record<'admin' | 'vendedor' | 'vendedor2' | 'cliente', string> = { admin: '', vendedor: '', vendedor2: '', cliente: '' };
const ids: Record<string, string> = {};

async function pedir<B>(metodo: 'GET' | 'POST', ruta: string, quien: keyof typeof tokens | null, cuerpo?: unknown) {
  const res = await fetch(`${base}/api/v1${ruta}`, {
    method: metodo,
    headers: { ...(quien ? { Authorization: `Bearer ${tokens[quien]}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json()) as B };
}

const nueva = (modelo: string, codigo: string, extra: Record<string, unknown> = {}) => ({ marcaImpresora: MARCA, modeloImpresora: modelo, codigoCartucho: codigo, ...extra });

async function relacion(codigo: string, modelo: string) {
  return prisma.cartridgePrinterModel.findFirst({
    where: { cartridge: { brand: { name: MARCA }, codeNormalized: codigo }, printerModel: { brand: { name: MARCA }, nameNormalized: modelo } },
  });
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string) {
  const u = await prisma.appUser.create({
    data: { email: `test.impr.${sufijo}@impresoras.local`, fullName: `Impresoras ${sufijo}`, role: rol, odooPartnerId: 3_800_000_000 + usuarios.length, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`impr-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  ids[sufijo] = u.id;
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  const restos =
    (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.appUser.count({ where: { email: { endsWith: '@impresoras.local' } } }));
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
  tokens.vendedor2 = await usuarioConToken('VENDEDOR', 'vendedor2');
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente');

  // Una propuesta como las del importador: sin autor, con la fila de origen.
  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const c = await prisma.cartridge.create({ data: { brandId: marca.id, code: 'ZZC-100', codeNormalized: 'zzc100', kind: 'TONER', yieldPages: 2000 } });
  for (const nombre of ['ZZJet 100', 'ZZJet 101']) {
    const m = await prisma.printerModel.create({ data: { brandId: marca.id, name: nombre, nameNormalized: nombre.toLowerCase().replace(/\s/g, '') } });
    await prisma.cartridgePrinterModel.create({ data: { cartridgeId: c.id, printerModelId: m.id, source: 'MANUAL', sourceRef: 'compatibilidad_productos #1: ZZJet 100/101', status: 'PROPUESTA' } });
  }
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

describe('#56 · Quién puede qué', () => {
  it('un vendedor no revisa ni añade como administrador: 403', async () => {
    expect((await pedir('GET', '/admin/compatibilidades/impresoras', 'vendedor')).status).toBe(403);
    expect((await pedir('POST', '/admin/compatibilidades/impresoras', 'vendedor', nueva('ZZJet 900', 'ZZC-900'))).status).toBe(403);
  });

  it('un cliente no propone: 403', async () => {
    expect((await pedir('POST', '/salesperson/compatibilidades', 'cliente', nueva('ZZJet 901', 'ZZC-901'))).status).toBe(403);
    expect(await relacion('zzc901', 'zzjet901')).toBeNull();
  });
});

describe('#56 · Listado para revisar', () => {
  it('agrupa por cartucho, con sus impresoras y la fila de origen', async () => {
    const r = await pedir<RevisionImpresorasRespuesta>('GET', `/admin/compatibilidades/impresoras?marca=${MARCA}`, 'admin');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(revisionImpresorasRespuestaSchema.safeParse(r.body).success).toBe(true);
    const [c] = r.body.data;
    expect([c.codigo, c.rendimientoPaginas, c.impresoras.map((i) => i.nombre)]).toEqual(['ZZC-100', 2000, ['ZZJet 100', 'ZZJet 101']]);
    expect(c.impresoras[0].origen).toBe('compatibilidad_productos #1: ZZJet 100/101');
  });

  it('busca por nombre de impresora sin espacios ni mayúsculas', async () => {
    const r = await pedir<RevisionImpresorasRespuesta>('GET', `/admin/compatibilidades/impresoras?marca=${MARCA}&q=zzjet101`, 'admin');
    expect(r.body.data.map((c) => c.codigo)).toEqual(['ZZC-100']);
  });
});

describe('#56 · Añadir', () => {
  it('el ADMINISTRADOR añade y nace VALIDADA, con autor y revisor', async () => {
    const r = await pedir<{ data: { estado: string; creada: boolean; impresoraNueva: boolean; cartuchoNuevo: boolean } }>(
      'POST',
      '/admin/compatibilidades/impresoras',
      'admin',
      nueva('ZZJet 200', 'ZZC-200', { tipo: 'DRUM' }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(nuevaCompatibilidadRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data).toMatchObject({ estado: 'VALIDADA', creada: true, impresoraNueva: true, cartuchoNuevo: true });
    const f = await relacion('zzc200', 'zzjet200');
    expect([f?.status, f?.createdBy, f?.reviewedBy]).toEqual(['VALIDADA', ids.admin, ids.admin]);
    expect((await prisma.cartridge.findFirstOrThrow({ where: { codeNormalized: 'zzc200', brand: { name: MARCA } } })).kind).toBe('DRUM');
    expect(eventos.some((e) => e.action === 'compatibilidad.anadida' && e.actorId === ids.admin)).toBe(true);
  });

  it('el VENDEDOR propone y nace PROPUESTA, aunque mande un estado en el cuerpo', async () => {
    const r = await pedir<{ data: { estado: string } }>('POST', '/salesperson/compatibilidades', 'vendedor', nueva('ZZJet 300', 'ZZC-300', { estado: 'VALIDADA', validar: true }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.estado).toBe('PROPUESTA');
    const f = await relacion('zzc300', 'zzjet300');
    expect([f?.status, f?.createdBy, f?.reviewedBy]).toEqual(['PROPUESTA', ids.vendedor, null]);
  });

  it('reutiliza la impresora y el cartucho que ya existen; la marca delante del modelo sobra', async () => {
    const r = await pedir<{ data: { impresoraNueva: boolean; cartuchoNuevo: boolean } }>('POST', '/salesperson/compatibilidades', 'vendedor', nueva(`${MARCA} zzjet-100`, 'zzc 200'));
    expect(r.body.data).toMatchObject({ impresoraNueva: false, cartuchoNuevo: false });
    expect(await prisma.printerModel.count({ where: { brand: { name: MARCA }, nameNormalized: 'zzjet100' } })).toBe(1);
  });

  it('volver a proponer algo VALIDADO no lo devuelve a pendiente; algo RECHAZADO no se reabre', async () => {
    const ya = await pedir<{ data: { estado: string; creada: boolean } }>('POST', '/salesperson/compatibilidades', 'vendedor2', nueva('ZZJet 200', 'ZZC-200'));
    expect(ya.status).toBe(200);
    expect(ya.body.data).toMatchObject({ estado: 'VALIDADA', creada: false });

    const f = await relacion('zzc100', 'zzjet101');
    await prisma.cartridgePrinterModel.update({ where: { cartridgeId_printerModelId: { cartridgeId: f!.cartridgeId, printerModelId: f!.printerModelId } }, data: { status: 'RECHAZADA' } });
    const otra = await pedir<{ data: { estado: string; creada: boolean } }>('POST', '/salesperson/compatibilidades', 'vendedor2', nueva('ZZJet 101', 'ZZC-100'));
    expect(otra.body.data).toMatchObject({ estado: 'RECHAZADA', creada: false });
    expect((await relacion('zzc100', 'zzjet101'))?.status).toBe('RECHAZADA');
  });

  it('un modelo sin número no es un modelo: 400', async () => {
    const r = await pedir('POST', '/salesperson/compatibilidades', 'vendedor', nueva('LaserJet Pro', 'ZZC-400'));
    expect(r.status).toBe(400);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('#56 · Las propias del vendedor', () => {
  it('ve solo lo que propuso él, con su estado', async () => {
    const r = await pedir<{ data: Array<{ codigoCartucho: string; modeloImpresora: string; estado: string }> }>('GET', '/salesperson/compatibilidades/propias', 'vendedor');
    expect(r.status).toBe(200);
    expect(propuestasPropiasRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data.map((p) => `${p.codigoCartucho}→${p.modeloImpresora}:${p.estado}`).sort()).toEqual(['ZZC-200→ZZJet 100:PROPUESTA', 'ZZC-300→ZZJet 300:PROPUESTA'].sort());
    const otro = await pedir<{ data: unknown[] }>('GET', '/salesperson/compatibilidades/propias', 'vendedor2');
    expect(otro.body.data).toEqual([]);
  });
});

describe('#56 · Revisar', () => {
  it('valida lo propuesto por un vendedor, y se refleja en «sus propuestas»', async () => {
    const f = await relacion('zzc300', 'zzjet300');
    const r = await pedir('POST', '/admin/compatibilidades/impresoras/revision', 'admin', {
      filas: [{ cartridgeId: f!.cartridgeId, printerModelId: f!.printerModelId, estadoEsperado: 'PROPUESTA' }],
      decision: 'VALIDADA',
    });
    expect(r.status).toBe(200);
    const propias = await pedir<{ data: Array<{ codigoCartucho: string; estado: string }> }>('GET', '/salesperson/compatibilidades/propias', 'vendedor');
    expect(propias.body.data.find((p) => p.codigoCartucho === 'ZZC-300')?.estado).toBe('VALIDADA');
  });

  it('todo o nada: si una fila cambió, 409 y no se toca la otra', async () => {
    const pendiente = await relacion('zzc100', 'zzjet100');
    const rechazada = await relacion('zzc100', 'zzjet101');
    const r = await pedir('POST', '/admin/compatibilidades/impresoras/revision', 'admin', {
      filas: [
        { cartridgeId: pendiente!.cartridgeId, printerModelId: pendiente!.printerModelId, estadoEsperado: 'PROPUESTA' },
        { cartridgeId: rechazada!.cartridgeId, printerModelId: rechazada!.printerModelId, estadoEsperado: 'PROPUESTA' },
      ],
      decision: 'VALIDADA',
    });
    expect(r.status).toBe(409);
    expect((await relacion('zzc100', 'zzjet100'))?.status).toBe('PROPUESTA');
  });
});
