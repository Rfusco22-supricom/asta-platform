import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { issueApiKey } from '../services/apiKey.service.js';

/**
 * Issue #28 — las API keys que un cliente gestiona de su propia cuenta.
 *
 * ── Qué se vigila aquí ───────────────────────────────────────────────────────
 *
 * Que un cliente no toque las keys de otro. Es el mismo riesgo de #36 por otra
 * puerta: allí una key ajena no puede LEER datos de otro; aquí una sesión ajena
 * no puede APAGAR la integración de otro.
 *
 * Y es un riesgo que existió de verdad. `revokeApiKey` revocaba por id sin mirar
 * de quién era la key. Mientras solo la llamaban los tests daba igual; al
 * exponerla a esta pantalla, cualquiera con una cuenta podía apagar la
 * integración de otro cliente mandando un uuid — sin leer nada suyo, así que ni
 * el aislamiento de lectura lo habría frenado.
 *
 * ── Sin Odoo ─────────────────────────────────────────────────────────────────
 *
 * Estos endpoints no consultan el ERP, así que el test tampoco. Los partners son
 * ids ficticios altos: lo que se prueba es el `where`, y para eso los datos de
 * verdad no aportan nada. Que corra sin Odoo importa —`isolation.test.ts` y
 * `publicIsolation.test.ts` no corren en una máquina sin credenciales, y estas
 * comprobaciones no pueden depender de eso.
 */

let server: Server;
let base = '';

interface Actor {
  userId: string;
  token: string;
}

let A: Actor;
let B: Actor;
let vendedor: Actor;

const usuariosCreados: string[] = [];

/** Ids que no existen en Odoo: nada de lo que se prueba aquí los consulta. */
const PARTNER_A = 990_000_101;
const PARTNER_B = 990_000_102;
const PARTNER_V = 990_000_103;

async function crearActor(
  rol: 'BRONCE' | 'VENDEDOR',
  partnerId: number,
  sufijo: string,
): Promise<Actor> {
  const email = `test.keys.${sufijo}@apikeys.local`;
  const usuario = await prisma.appUser.upsert({
    where: { email },
    create: {
      email,
      fullName: `Test ${sufijo}`,
      role: rol,
      odooPartnerId: partnerId,
      odooUserId: rol === 'VENDEDOR' ? partnerId : null,
      isActive: true,
    },
    update: { role: rol, isActive: true },
  });
  usuariosCreados.push(usuario.id);

  const sesion = await prisma.userSession.create({
    data: {
      userId: usuario.id,
      refreshTokenHash: hashSecreto(`test-keys-${sufijo}-${Date.now()}-${Math.random()}`),
      expiresAt: caducaEnDias(1),
    },
    select: { id: true },
  });

  return {
    userId: usuario.id,
    token: await emitirAccessToken({
      sub: usuario.id,
      role: rol,
      odooPartnerId: usuario.odooPartnerId,
      odooUserId: usuario.odooUserId,
      sid: sesion.id,
    }),
  };
}

interface Respuesta {
  status: number;
  body: {
    data?: unknown;
    meta?: { total?: number; vivas?: number; maximo?: number };
    error?: { code?: string; message?: string };
  } | null;
}

async function llamar(
  metodo: string,
  ruta: string,
  actor: Actor,
  cuerpo?: unknown,
): Promise<Respuesta> {
  const res = await fetch(`${base}/api/v1/account${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${actor.token}`,
      ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const body = res.status === 204 ? null : ((await res.json().catch(() => null)) as Respuesta['body']);
  return { status: res.status, body };
}

const listar = (a: Actor) => llamar('GET', '/api-keys', a);
const crear = (a: Actor, cuerpo: unknown) => llamar('POST', '/api-keys', a, cuerpo);
const revocar = (a: Actor, id: string) => llamar('DELETE', `/api-keys/${id}`, a, {});

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((listo) => {
    server = app.listen(0, () => {
      const dir = server.address();
      base = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`;
      listo();
    });
  });

  A = await crearActor('BRONCE', PARTNER_A, 'a');
  B = await crearActor('BRONCE', PARTNER_B, 'b');
  vendedor = await crearActor('VENDEDOR', PARTNER_V, 'v');
});

afterAll(async () => {
  // Las keys y las sesiones caen con el usuario por `onDelete: Cascade`.
  if (usuariosCreados.length > 0) {
    await prisma.apiKey.deleteMany({ where: { userId: { in: usuariosCreados } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  }
  await prisma.$disconnect();
  await new Promise<void>((listo) => server.close(() => listo()));
});

describe('#28 · cada cliente ve solo sus keys', () => {
  it('el listado de A no contiene ninguna key de B', async () => {
    const deA = await issueApiKey({ userId: A.userId, name: 'de A', scopes: ['INVOICES_READ'] });
    const deB = await issueApiKey({ userId: B.userId, name: 'de B', scopes: ['INVOICES_READ'] });

    const r = await listar(A);
    expect(r.status).toBe(200);

    const ids = (r.body?.data as Array<{ id: string }>).map((k) => k.id);
    expect(ids).toContain(deA.id);
    expect(ids).not.toContain(deB.id);
  });

  it('el listado NUNCA devuelve el token ni su hash', async () => {
    await issueApiKey({ userId: A.userId, name: 'secretos', scopes: ['INVENTORY_READ'] });
    const r = await listar(A);

    // Sobre el JSON entero, no campo a campo: si mañana alguien añade un campo
    // al `select` del servicio, esto lo caza igual.
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain('asta_live_');
    expect(texto).not.toMatch(/"keyHash"/);
  });

  it('usageCount se serializa aunque la columna sea BIGINT', async () => {
    // `usage_count` es BIGINT y Prisma lo devuelve como `bigint`, que
    // `JSON.stringify` no sabe serializar: sin el `Number(...)` del servicio,
    // este endpoint responde 500 con CUALQUIER key, incluida una recién creada.
    const r = await listar(A);
    expect(r.status).toBe(200);
    for (const k of r.body?.data as Array<{ usageCount: unknown }>) {
      expect(typeof k.usageCount).toBe('number');
    }
  });
});

describe('#28 · un cliente no toca las keys de otro', () => {
  it('A no puede revocar la key de B, y la de B sigue viva', async () => {
    const deB = await issueApiKey({ userId: B.userId, name: 'victima', scopes: ['INVOICES_READ'] });

    const r = await revocar(A, deB.id);
    expect(r.status).toBe(404);

    // Lo que importa no es el código: es que la key siga funcionando.
    const enBase = await prisma.apiKey.findUnique({
      where: { id: deB.id },
      select: { revokedAt: true },
    });
    expect(enBase?.revokedAt).toBeNull();
  });

  it('el 404 de una key ajena es idéntico al de una inexistente', async () => {
    // Si se distinguieran, probando uuids se sabría cuáles están en uso por
    // otros clientes. El endpoint sería un oráculo.
    const deB = await issueApiKey({ userId: B.userId, name: 'oraculo', scopes: ['INVOICES_READ'] });

    const ajena = await revocar(A, deB.id);
    const inventada = await revocar(A, '00000000-0000-4000-8000-000000000000');

    expect(ajena.status).toBe(inventada.status);
    expect(ajena.body?.error?.message).toBe(inventada.body?.error?.message);
  });

  it('A no puede ver el historial de uso de una key de B', async () => {
    const deB = await issueApiKey({ userId: B.userId, name: 'historial', scopes: ['INVOICES_READ'] });
    const r = await llamar('GET', `/api-keys/${deB.id}/usage`, A);
    expect(r.status).toBe(404);
    expect(r.body?.data).toBeUndefined();
  });

  it('A sí puede revocar la suya', async () => {
    const deA = await issueApiKey({ userId: A.userId, name: 'propia', scopes: ['INVOICES_READ'] });

    expect((await revocar(A, deA.id)).status).toBe(204);

    const enBase = await prisma.apiKey.findUnique({
      where: { id: deA.id },
      select: { revokedAt: true },
    });
    expect(enBase?.revokedAt).not.toBeNull();
  });
});

describe('#28 · quién puede entrar', () => {
  it('un VENDEDOR recibe 403: las keys son para integrar el sistema de un cliente', async () => {
    const r = await listar(vendedor);
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('sin sesión, 401', async () => {
    const res = await fetch(`${base}/api/v1/account/api-keys`);
    expect(res.status).toBe(401);
  });
});

describe('#28 · crear', () => {
  it('sin ningún scope, 400: ninguna key nace con todos los permisos', async () => {
    const r = await crear(A, { name: 'sin permisos', scopes: [] });
    expect(r.status).toBe(400);
  });

  it('el token en claro se devuelve UNA vez y no reaparece en el listado', async () => {
    const r = await crear(A, { name: 'de un solo uso', scopes: ['INVENTORY_READ'] });
    expect(r.status).toBe(201);

    const creada = r.body?.data as { id: string; plaintext: string };
    expect(creada.plaintext).toMatch(/^asta_live_[0-9a-f]{8}_/);

    const lista = await listar(A);
    expect(JSON.stringify(lista.body)).not.toContain(creada.plaintext);
  });

  it('scopes repetidos no rompen el INSERT', async () => {
    // `api_key_scopes` tiene primaria `(apiKeyId, scope)`: sin deduplicar, un
    // formulario con una casilla duplicada da un 500 sin explicación.
    const r = await crear(A, {
      name: 'repetidos',
      scopes: ['INVOICES_READ', 'INVOICES_READ', 'INVENTORY_READ'],
    });
    expect(r.status).toBe(201);
    expect((r.body?.data as { scopes: string[] }).scopes.sort()).toEqual([
      'INVENTORY_READ',
      'INVOICES_READ',
    ]);
  });

  it('un scope inventado se rechaza, no se guarda', async () => {
    const r = await crear(A, { name: 'inventado', scopes: ['BORRAR_TODO'] });
    expect(r.status).toBe(400);
  });

  it('al llegar al tope responde 409, y revocar una libera hueco', async () => {
    const propio = await crearActor('BRONCE', 990_000_104, 'tope');

    const creadas: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await crear(propio, { name: `tope ${i}`, scopes: ['INVENTORY_READ'] });
      expect(r.status).toBe(201);
      creadas.push((r.body?.data as { id: string }).id);
    }

    const pasada = await crear(propio, { name: 'la once', scopes: ['INVENTORY_READ'] });
    expect(pasada.status).toBe(409);

    expect((await revocar(propio, creadas[0])).status).toBe(204);

    const despues = await crear(propio, { name: 'tras revocar', scopes: ['INVENTORY_READ'] });
    expect(despues.status).toBe(201);
  });
});
