import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { apiErrorSchema, revisionRespuestaSchema, type RevisionRespuesta } from '@asta/shared-types';
import { createApp } from '../server.js';
import { searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { vaciarCachesRevision } from '../services/recomendador/revision.service.js';

/**
 * #56 · Revisión de compatibilidades desde el panel, contra servidor, MySQL y Odoo.
 *
 * Lo que se vigila:
 *
 *   · solo administración: validar pone un tóner delante del cliente (#39)
 *   · nunca se pisa la decisión de otra persona, y una petición es todo o nada
 *   · queda quién y cuándo, en la fila y en la auditoría
 *   · lo más vendido primero, que es sobre lo que se mide la cobertura
 *
 * Datos propios: una marca `ZZ_REV_MARCA` y cartuchos `ZZREV*` que no existen,
 * colgados de productos reales —el nombre y las ventas salen de Odoo— y de una
 * plantilla que no existe en Odoo. Al borrar los cartuchos, el ON DELETE CASCADE
 * se lleva sus filas.
 */

const MARCA = 'ZZ_REV_MARCA';
const CODIGOS = ['zzrev1', 'zzrev2', 'zzrev3'];
const PLANTILLA_INEXISTENTE = 4_000_000_001;

let server: Server;
let base = '';
let comprobado = false;
const usuarios: string[] = [];
const eventos: AuditEvent[] = [];
const tokens: Record<'admin' | 'vendedor', string> = { admin: '', vendedor: '' };
let adminId = '';
/** Plantillas reales: la más vendida y otras dos. */
const T = { a: 0, b: 0, c: 0 };
const C = { c1: 0, c2: 0, c3: 0 };

async function pedir<B>(metodo: 'GET' | 'POST' | 'PATCH', ruta: string, opciones: { quien?: keyof typeof tokens | null; cuerpo?: unknown } = {}) {
  const quien = opciones.quien === undefined ? 'admin' : opciones.quien;
  const res = await fetch(`${base}/api/v1/admin${ruta}`, {
    method: metodo,
    headers: {
      ...(quien ? { Authorization: `Bearer ${tokens[quien]}` } : {}),
      ...(opciones.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json()) as B };
}

const listar = (query = '') => pedir<RevisionRespuesta>('GET', `/compatibilidades/productos?marca=${MARCA}${query}`);
const fila = (templateId: number, cartridgeId: number) =>
  prisma.productCartridge.findUniqueOrThrow({ where: { odooProductTmplId_cartridgeId: { odooProductTmplId: templateId, cartridgeId } } });

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string) {
  const u = await prisma.appUser.create({
    data: { email: `test.revision.${sufijo}@revision.local`, fullName: `Revisión ${sufijo}`, role: rol, odooPartnerId: 3_900_000_000 + usuarios.length, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`revision-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  const token = await emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
  return { id: u.id, token };
}

beforeAll(async () => {
  const yaEsta = await prisma.printerBrand.count({ where: { name: MARCA } });
  const cartuchos = await prisma.cartridge.count({ where: { codeNormalized: { in: CODIGOS } } });
  const correos = await prisma.appUser.count({ where: { email: { endsWith: '@revision.local' } } });
  if (yaEsta || cartuchos || correos) throw new Error(`Restos de ${MARCA} en la base: el test no puede distinguir lo suyo. Límpialos a mano.`);
  comprobado = true;

  registerAuditSink((e) => eventos.push(e));

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  const admin = await usuarioConToken('SUPERADMIN', 'admin');
  const vendedor = await usuarioConToken('VENDEDOR', 'vendedor');
  adminId = admin.id;
  tokens.admin = admin.token;
  tokens.vendedor = vendedor.token;

  // Tres consumibles reales a la venta SIN ninguna fila en product_cartridges:
  // con la carga del importador hecha, cualquier otro trae candidatos que no son
  // de este test, y el listado enseña todos los de un producto.
  const productos = await searchRead<{ product_tmpl_id: [number, string] }>(
    'product.product',
    [['sale_ok', '=', true], ['detailed_type', '=', 'product'], ['categ_id', 'child_of', 2614]],
    ['product_tmpl_id'],
    { limit: 1000, order: 'id' },
  );
  const candidatas = [...new Set(productos.map((p) => p.product_tmpl_id[0]))];
  const ocupadas = new Set(
    (await prisma.productCartridge.findMany({ where: { odooProductTmplId: { in: candidatas } }, select: { odooProductTmplId: true } })).map((f) => f.odooProductTmplId),
  );
  [T.a, T.b, T.c] = candidatas.filter((t) => !ocupadas.has(t));
  if (!T.c) throw new Error('Hacen falta 3 consumibles a la venta sin propuestas cargadas para el test.');

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const cartucho = (code: string) => prisma.cartridge.create({ data: { brandId: marca.id, code, codeNormalized: code.toLowerCase(), kind: 'TONER' } });
  C.c1 = (await cartucho('ZZREV1')).id;
  C.c2 = (await cartucho('ZZREV2')).id;
  C.c3 = (await cartucho('ZZREV3')).id;

  await prisma.productCartridge.createMany({
    data: [
      { odooProductTmplId: T.a, cartridgeId: C.c1, relation: 'ORIGINAL', source: 'PARSEO', evidence: 'ZZREV1', status: 'PROPUESTA' },
      { odooProductTmplId: T.a, cartridgeId: C.c2, relation: 'COMPATIBLE', source: 'PARSEO', evidence: 'ZZREV2', status: 'VALIDADA' },
      { odooProductTmplId: T.b, cartridgeId: C.c1, relation: 'ORIGINAL', source: 'PARSEO', status: 'PROPUESTA' },
      { odooProductTmplId: T.c, cartridgeId: C.c3, relation: 'ORIGINAL', source: 'PARSEO', status: 'RECHAZADA' },
      { odooProductTmplId: PLANTILLA_INEXISTENTE, cartridgeId: C.c3, relation: 'ORIGINAL', source: 'PARSEO', status: 'PROPUESTA' },
    ],
  });
  vaciarCachesRevision();
}, 180_000);

afterAll(async () => {
  // Vitest ejecuta afterAll aunque beforeAll falle: sin la comprobación, lo que
  // haya con estos nombres no es de este test.
  if (comprobado) {
    await prisma.cartridge.deleteMany({ where: { codeNormalized: { in: CODIGOS }, brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    if (usuarios.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
      await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
    }
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('#56 · Quién puede', () => {
  it('un VENDEDOR no puede listar, decidir ni corregir: 403', async () => {
    const r = [
      await pedir('GET', '/compatibilidades/productos', { quien: 'vendedor' }),
      await pedir('POST', '/compatibilidades/productos/revision', { quien: 'vendedor', cuerpo: { filas: [{ templateId: T.b, cartridgeId: C.c1, estadoEsperado: 'PROPUESTA' }], decision: 'VALIDADA' } }),
      await pedir('PATCH', `/compatibilidades/cartuchos/${C.c1}`, { quien: 'vendedor', cuerpo: { tipo: 'TINTA' } }),
    ];
    expect(r.map((x) => x.status)).toEqual([403, 403, 403]);
    expect((await fila(T.b, C.c1)).status).toBe('PROPUESTA');
    expect((await prisma.cartridge.findUniqueOrThrow({ where: { id: C.c1 } })).kind).toBe('TONER');
  });

  it('sin sesión: 401', async () => {
    expect((await pedir('GET', '/compatibilidades/productos', { quien: null })).status).toBe(401);
  });
});

describe('#56 · Listado', () => {
  it('cumple el contrato y trae nombre y referencia de Odoo', async () => {
    const r = await listar();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = revisionRespuestaSchema.safeParse(r.body);
    expect(v.success, JSON.stringify(v.error?.issues)).toBe(true);
    const a = r.body.data.find((p) => p.templateId === T.a)!;
    const [odoo] = await searchRead<{ name: string }>('product.template', [['id', '=', T.a]], ['name']);
    expect(a.nombre).toBe(odoo.name);
  });

  it('por defecto, productos con algo PENDIENTE; con TODOS sus candidatos, también los ya decididos', async () => {
    const r = await listar();
    expect(r.body.data.map((p) => p.templateId).sort()).toEqual([T.a, T.b, PLANTILLA_INEXISTENTE].sort());
    const a = r.body.data.find((p) => p.templateId === T.a)!;
    expect(a.candidatos.map((c) => [c.codigo, c.estado])).toEqual([
      ['ZZREV1', 'PROPUESTA'],
      ['ZZREV2', 'VALIDADA'],
    ]);
    expect(a.candidatos[0].evidencia).toBe('ZZREV1');
  });

  it('una plantilla que ya no existe en Odoo sale igual, sin nombre, para poder rechazarla', async () => {
    const p = (await listar()).body.data.find((x) => x.templateId === PLANTILLA_INEXISTENTE)!;
    expect([p.nombre, p.activoEnOdoo, p.ventas12m]).toEqual([null, false, 0]);
  });

  it('lo más vendido primero', async () => {
    const ventas = (await listar()).body.data.map((p) => p.ventas12m);
    // Con todo a cero el orden no probaría nada.
    expect(ventas.filter((v) => v > 0).length, 'los productos del test no tienen ventas distintas').toBeGreaterThan(1);
    expect(ventas).toEqual([...ventas].sort((x, y) => y - x));
  });

  it('filtra por estado', async () => {
    expect((await listar('&estado=RECHAZADA')).body.data.map((p) => p.templateId)).toEqual([T.c]);
  });

  it('busca por código de cartucho, sin guiones ni mayúsculas, y por nombre del producto', async () => {
    expect((await listar('&q=zz-rev-1')).body.data.map((p) => p.templateId).sort()).toEqual([T.a, T.b].sort());
    const nombre = (await listar()).body.data.find((p) => p.templateId === T.b)!.nombre!;
    const trozo = nombre.slice(0, Math.min(12, nombre.length));
    expect((await listar(`&q=${encodeURIComponent(trozo)}`)).body.data.map((p) => p.templateId)).toContain(T.b);
  });

  it('pagina por producto y cuenta el total', async () => {
    const r = await listar('&porPagina=2&pagina=2');
    expect(r.body.meta.totalProductos).toBe(3);
    expect(r.body.data).toHaveLength(1);
  });

  it('query inválida: 400', async () => {
    expect((await pedir('GET', '/compatibilidades/productos?estado=CUALQUIERA')).status).toBe(400);
  });
});

describe('#56 · Decidir', () => {
  it('valida en lote y deja quién y cuándo, en la fila y en la auditoría', async () => {
    const antes = Date.now();
    const r = await pedir<{ data: { actualizadas: number } }>('POST', '/compatibilidades/productos/revision', {
      cuerpo: {
        filas: [
          { templateId: T.a, cartridgeId: C.c1, estadoEsperado: 'PROPUESTA' },
          { templateId: T.b, cartridgeId: C.c1, estadoEsperado: 'PROPUESTA' },
        ],
        decision: 'VALIDADA',
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.actualizadas).toBe(2);
    for (const t of [T.a, T.b]) {
      const f = await fila(t, C.c1);
      expect(f.status).toBe('VALIDADA');
      expect(f.reviewedBy).toBe(adminId);
      expect(f.reviewedAt!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    }
    const e = eventos.filter((x) => x.action === 'compatibilidad.revisada').at(-1)!;
    expect(e.actorId).toBe(adminId);
    expect(e.metadata).toMatchObject({ decision: 'VALIDADA', filas: [{ templateId: T.a, antes: 'PROPUESTA' }, { templateId: T.b, antes: 'PROPUESTA' }] });
  });

  it('si otra persona ya decidió una fila: 409 y NO se toca ninguna de la petición', async () => {
    const r = await pedir('POST', '/compatibilidades/productos/revision', {
      cuerpo: {
        filas: [
          { templateId: PLANTILLA_INEXISTENTE, cartridgeId: C.c3, estadoEsperado: 'PROPUESTA' },
          // Ya VALIDADA por el test anterior: la pantalla de esta persona estaba vieja.
          { templateId: T.a, cartridgeId: C.c1, estadoEsperado: 'PROPUESTA' },
        ],
        decision: 'RECHAZADA',
      },
    });
    expect(r.status).toBe(409);
    expect(apiErrorSchema.parse(r.body).error.code).toBe('CONFLICT');
    expect((await fila(PLANTILLA_INEXISTENTE, C.c3)).status).toBe('PROPUESTA');
    expect((await fila(T.a, C.c1)).status).toBe('VALIDADA');
  });

  it('una fila que no existe también es 409, no un éxito silencioso', async () => {
    const r = await pedir('POST', '/compatibilidades/productos/revision', {
      cuerpo: { filas: [{ templateId: T.c, cartridgeId: C.c1, estadoEsperado: 'PROPUESTA' }], decision: 'VALIDADA' },
    });
    expect(r.status).toBe(409);
  });

  it('devolver a pendiente borra quién y cuándo', async () => {
    const r = await pedir('POST', '/compatibilidades/productos/revision', {
      cuerpo: { filas: [{ templateId: T.b, cartridgeId: C.c1, estadoEsperado: 'VALIDADA' }], decision: 'PROPUESTA' },
    });
    expect(r.status).toBe(200);
    const f = await fila(T.b, C.c1);
    expect([f.status, f.reviewedBy, f.reviewedAt]).toEqual(['PROPUESTA', null, null]);
  });

  it('corrige original/compatible al decidir, de una fila en una', async () => {
    const una = await pedir('POST', '/compatibilidades/productos/revision', {
      cuerpo: { filas: [{ templateId: T.b, cartridgeId: C.c1, estadoEsperado: 'PROPUESTA' }], decision: 'VALIDADA', relacion: 'COMPATIBLE' },
    });
    expect(una.status).toBe(200);
    expect((await fila(T.b, C.c1)).relation).toBe('COMPATIBLE');

    const varias = await pedir('POST', '/compatibilidades/productos/revision', {
      cuerpo: {
        filas: [
          { templateId: PLANTILLA_INEXISTENTE, cartridgeId: C.c3, estadoEsperado: 'PROPUESTA' },
          { templateId: T.c, cartridgeId: C.c3, estadoEsperado: 'RECHAZADA' },
        ],
        decision: 'VALIDADA',
        relacion: 'COMPATIBLE',
      },
    });
    expect(varias.status).toBe(400);
    expect((await fila(PLANTILLA_INEXISTENTE, C.c3)).status).toBe('PROPUESTA');
  });

  it('filas repetidas, cuerpo vacío o ids fuera de rango: 400', async () => {
    const repetida = { templateId: T.c, cartridgeId: C.c3, estadoEsperado: 'RECHAZADA' };
    for (const cuerpo of [
      { filas: [repetida, repetida], decision: 'VALIDADA' },
      { filas: [], decision: 'VALIDADA' },
      { filas: [{ ...repetida, templateId: 99_999_999_999 }], decision: 'VALIDADA' },
      { filas: [repetida], decision: 'BORRADA' },
    ]) {
      expect((await pedir('POST', '/compatibilidades/productos/revision', { cuerpo })).status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect((await fila(T.c, C.c3)).status).toBe('RECHAZADA');
  });
});

describe('#56 · Corregir el tipo del cartucho', () => {
  it('lo cambia y lo audita con el valor anterior', async () => {
    const r = await pedir('PATCH', `/compatibilidades/cartuchos/${C.c2}`, { cuerpo: { tipo: 'DRUM' } });
    expect(r.status).toBe(200);
    expect((await prisma.cartridge.findUniqueOrThrow({ where: { id: C.c2 } })).kind).toBe('DRUM');
    const e = eventos.filter((x) => x.action === 'cartucho.tipo_corregido').at(-1)!;
    expect([e.actorId, e.targetId, e.metadata]).toEqual([adminId, String(C.c2), { antes: 'TONER', despues: 'DRUM' }]);
  });

  it('tipo inválido: 400; cartucho que no existe: 404', async () => {
    expect((await pedir('PATCH', `/compatibilidades/cartuchos/${C.c2}`, { cuerpo: { tipo: 'CAFE' } })).status).toBe(400);
    expect((await pedir('PATCH', '/compatibilidades/cartuchos/4000000000', { cuerpo: { tipo: 'TONER' } })).status).toBe(404);
  });
});
