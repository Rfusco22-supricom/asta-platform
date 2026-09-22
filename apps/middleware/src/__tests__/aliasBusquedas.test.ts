import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema, busquedaImpresorasRespuestaSchema, type BusquedaImpresorasRespuesta } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * #43 · Convertir una búsqueda sin resultado en un alias, desde el panel.
 *
 * Es el bucle que hace que el recomendador aprenda de sus fallos: el cliente
 * teclea «zzhl9350», no encuentra nada, y alguien ata ese texto a su impresora.
 * Lo que este fichero vigila es que **la misma búsqueda funcione después**, sin
 * esperar a que caduque la cache del catálogo.
 *
 * Datos `ZZ_ALIAS` que no existen, creados y borrados aquí.
 */

const MARCA = 'ZZ_ALIAS_MARCA';

let server: Server;
let base = '';
let comprobado = false;
const usuarios: string[] = [];
const eventos: AuditEvent[] = [];
const tokens: Record<'admin' | 'vendedor', string> = { admin: '', vendedor: '' };
const P = { activa: 0, retirada: 0 };

async function pedir<B>(metodo: 'GET' | 'POST', ruta: string, quien: keyof typeof tokens = 'admin', cuerpo?: unknown) {
  const res = await fetch(`${base}/api/v1/admin${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokens[quien]}`, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json()) as B };
}

const buscar = (q: string) => pedir<BusquedaImpresorasRespuesta>('GET', `/compatibilidades/impresoras/buscar?q=${encodeURIComponent(q)}`);
const atar = (printerModelId: number, alias: string) => pedir<{ data: { creado: boolean; estabaDesactivado: boolean } }>('POST', '/compatibilidades/alias', 'admin', { printerModelId, alias });

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string) {
  const u = await prisma.appUser.create({
    data: { email: `test.alias.${sufijo}@alias.local`, fullName: `Alias ${sufijo}`, role: rol, odooPartnerId: 3_700_000_000 + usuarios.length, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`alias-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  const restos = (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.appUser.count({ where: { email: { endsWith: '@alias.local' } } }));
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

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const activa = await prisma.printerModel.create({ data: { brandId: marca.id, name: 'ZZ-Alias 9350dw', nameNormalized: 'zzalias9350dw' } });
  const retirada = await prisma.printerModel.create({ data: { brandId: marca.id, name: 'ZZ-Alias 9360dw', nameNormalized: 'zzalias9360dw', isActive: false } });
  [P.activa, P.retirada] = [activa.id, retirada.id];
  vaciarCachesRecomendador();
}, 120_000);

afterAll(async () => {
  if (comprobado) {
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    if (usuarios.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
      await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
    }
  }
  vaciarCachesRecomendador();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#43 · Quién puede', () => {
  it('un vendedor no busca impresoras ni ata alias: 403', async () => {
    expect((await pedir('GET', '/compatibilidades/impresoras/buscar?q=zzalias', 'vendedor')).status).toBe(403);
    expect((await pedir('POST', '/compatibilidades/alias', 'vendedor', { printerModelId: P.activa, alias: 'zzcuela9350' })).status).toBe(403);
    expect(await prisma.printerModelAlias.count({ where: { aliasNormalized: 'zzcuela9350' } })).toBe(0);
  });
});

describe('#43 · Elegir la impresora', () => {
  it('busca con la misma regla que el kiosco y cumple el contrato', async () => {
    const r = await buscar('zzalias9350dw');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(busquedaImpresorasRespuestaSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.data.map((i) => i.printerModelId)).toContain(P.activa);
  });

  it('incluye la que el kiosco todavía NO enseña, y lo dice', async () => {
    // Sin compatibilidad validada, el kiosco no la ve (#111/#112). Pero hay que
    // poder atarle el alias: es el caso de las 309 recién importadas.
    const fila = (await buscar('zzalias9350dw')).body.data.find((i) => i.printerModelId === P.activa);
    expect(fila?.visibleEnKiosco).toBe(false);
  });

  it('no ofrece una impresora retirada', async () => {
    const r = await buscar('zzalias9360dw');
    expect([...r.body.data, ...r.body.sugerencias].map((i) => i.printerModelId)).not.toContain(P.retirada);
  });

  it('un texto de una letra: 400', async () => {
    expect((await buscar('z')).status).toBe(400);
  });
});

describe('#43 · Atar la búsqueda como alias', () => {
  it('la búsqueda que no encontraba nada, después SÍ encuentra la impresora', async () => {
    // Antes: el texto del cliente no lleva a ninguna parte.
    expect((await buscar('zzhl9350')).body.data).toHaveLength(0);

    const r = await atar(P.activa, 'ZZ HL 9350');
    expect(r.status).toBe(201);
    expect(r.body.data.creado).toBe(true);

    // Después, y sin esperar a que caduque la cache del catálogo.
    expect((await buscar('zzhl9350')).body.data.map((i) => i.printerModelId)).toEqual([P.activa]);
  });

  it('se guarda normalizado, como BUSQUEDA, y queda en la auditoría', async () => {
    const alias = await prisma.printerModelAlias.findFirstOrThrow({ where: { printerModelId: P.activa, aliasNormalized: 'zzhl9350' } });
    expect([alias.alias, alias.source, alias.isActive]).toEqual(['ZZ HL 9350', 'BUSQUEDA', true]);
    expect(eventos.filter((e) => e.action === 'alias.anadido').at(-1)?.metadata).toMatchObject({ alias: 'ZZ HL 9350' });
  });

  it('atarlo otra vez no lo duplica', async () => {
    const r = await atar(P.activa, 'zz-hl-9350');
    expect(r.status).toBe(200);
    expect(r.body.data.creado).toBe(false);
    expect(await prisma.printerModelAlias.count({ where: { printerModelId: P.activa, aliasNormalized: 'zzhl9350' } })).toBe(1);
  });

  it('un alias DESACTIVADO no se reactiva: se retiró por algo', async () => {
    await prisma.printerModelAlias.create({
      data: { printerModelId: P.activa, alias: 'zzmalo9350', aliasNormalized: 'zzmalo9350', source: 'MANUAL', isActive: false },
    });
    const r = await atar(P.activa, 'ZZMALO 9350');
    expect(r.body.data).toMatchObject({ creado: false, estabaDesactivado: true });
    expect((await prisma.printerModelAlias.findFirstOrThrow({ where: { aliasNormalized: 'zzmalo9350' } })).isActive).toBe(false);
  });

  it('una impresora retirada o inexistente: 404', async () => {
    for (const id of [P.retirada, 4_000_000_000]) {
      const r = await pedir<unknown>('POST', '/compatibilidades/alias', 'admin', { printerModelId: id, alias: 'zzsuelto9350' });
      expect(r.status, String(id)).toBe(404);
      expect(apiErrorSchema.parse(r.body).error.code).toBe('PRINTER_NOT_FOUND');
    }
  });

  it('un texto que no deja nada al normalizar: 400, no un alias vacío', async () => {
    const r = await pedir<unknown>('POST', '/compatibilidades/alias', 'admin', { printerModelId: P.activa, alias: '¿¿--??' });
    expect(r.status).toBe(400);
    expect(await prisma.printerModelAlias.count({ where: { printerModelId: P.activa, aliasNormalized: '' } })).toBe(0);
  });
});
