import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { describirDispositivo } from '../services/sessions.service.js';

/**
 * Issue #52 — Sesiones activas.
 *
 * Lo que se prueba aquí no es que la lista salga bonita, sino el invariante del
 * que depende toda la pantalla: **un usuario solo ve y cierra sus sesiones.**
 *
 * Importa más de lo que parece. Si `revocarSesion` cerrara por id sin comprobar
 * el dueño, cualquiera con una cuenta válida podría echar a otro probando UUIDs
 * —una denegación de servicio contra una cuenta ajena, servida desde el propio
 * panel— y la pantalla que existe para dar seguridad sería el agujero.
 *
 * No toca Odoo: las sesiones viven solo en MySQL. Se crean usuarios de prueba
 * propios, con su email, y se borran al terminar.
 */

let server: Server;
let base: string;

interface Actor {
  userId: string;
  /** Token de la sesión desde la que "mira" este actor. */
  token: string;
  sesionActual: string;
  /** Otras sesiones suyas, con su token, para comprobar que se revocan de verdad. */
  otras: Array<{ id: string; token: string }>;
}

const creados: string[] = [];

const UA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function crearSesion(
  userId: string,
  odooPartnerId: number,
  userAgent: string,
  ip: string,
): Promise<{ id: string; token: string }> {
  const sesion = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashSecreto(`test-sesiones-${Date.now()}-${Math.random()}`),
      expiresAt: caducaEnDias(1),
      userAgent,
      ip,
    },
    select: { id: true },
  });

  return {
    id: sesion.id,
    token: await emitirAccessToken({
      sub: userId,
      role: 'VENDEDOR',
      odooPartnerId,
      odooUserId: null,
      sid: sesion.id,
    }),
  };
}

async function crearActor(etiqueta: string, cuantasOtras: number): Promise<Actor> {
  const email = `test.sesiones.${etiqueta}@aislamiento.local`;

  const usuario = await prisma.appUser.upsert({
    where: { email },
    create: {
      email,
      fullName: `Test sesiones ${etiqueta}`,
      role: 'VENDEDOR',
      // Rango alto y propio para no chocar con partners reales ni con los
      // usuarios del seed de desarrollo.
      odooPartnerId: 990_000 + etiqueta.charCodeAt(0),
      odooUserId: null,
      isActive: true,
    },
    update: { isActive: true, role: 'VENDEDOR' },
  });
  creados.push(usuario.id);

  // Se cierran las que hubiera de una ejecución anterior: si no, los conteos
  // arrastrarían sesiones viejas y el test pasaría o fallaría según el historial.
  await prisma.userSession.updateMany({
    where: { userId: usuario.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'logout' },
  });

  const actual = await crearSesion(usuario.id, usuario.odooPartnerId, UA_WINDOWS, '190.72.14.10');

  const otras = [];
  for (let i = 0; i < cuantasOtras; i++) {
    otras.push(
      await crearSesion(usuario.id, usuario.odooPartnerId, UA_IPHONE, `190.72.14.${20 + i}`),
    );
  }

  return { userId: usuario.id, token: actual.token, sesionActual: actual.id, otras };
}

async function pedir(
  metodo: string,
  ruta: string,
  token?: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

let ana: Actor;
let beto: Actor;

beforeAll(async () => {
  await new Promise<void>((listo) => {
    server = createApp().listen(0, () => {
      const dir = server.address();
      base = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`;
      listo();
    });
  });

  ana = await crearActor('ana', 3);
  beto = await crearActor('beto', 1);
}, 60_000);

afterAll(async () => {
  await new Promise<void>((listo) => server.close(() => listo()));
  // Las sesiones caen por la FK en cascada.
  if (creados.length > 0) {
    await prisma.appUser.deleteMany({ where: { id: { in: creados } } });
  }
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#52 · Listado de sesiones', () => {
  it('devuelve las sesiones vivas del usuario y marca la actual', async () => {
    const r = await pedir('GET', '/api/v1/auth/sessions', ana.token);

    expect(r.status).toBe(200);
    expect(r.body.meta).toEqual({ total: 4, otras: 3 });

    const actuales = r.body.data.filter((s: { esActual: boolean }) => s.esActual);
    // Exactamente una, y la que toca. Si `sessionId` no llegara a la identidad,
    // serían cero, y la pantalla dejaría cerrar la propia por error.
    expect(actuales).toHaveLength(1);
    expect(actuales[0].id).toBe(ana.sesionActual);
  });

  it('NO devuelve las sesiones de otro usuario', async () => {
    const r = await pedir('GET', '/api/v1/auth/sessions', ana.token);
    const ids = r.body.data.map((s: { id: string }) => s.id);

    for (const ajena of [beto.sesionActual, ...beto.otras.map((s) => s.id)]) {
      expect(ids).not.toContain(ajena);
    }
  });

  it('NUNCA expone el hash del refresh token', async () => {
    const r = await pedir('GET', '/api/v1/auth/sessions', ana.token);

    // Es el único secreto de la tabla. Un hash no es el token, pero publicarlo
    // permite confirmar un token robado por comparación.
    const crudo = JSON.stringify(r.body);
    expect(crudo).not.toMatch(/refreshTokenHash|refresh_token_hash/);
    for (const s of r.body.data) {
      expect(Object.keys(s).sort()).toEqual(
        ['dispositivo', 'esActual', 'expiraEn', 'id', 'iniciadaEn', 'ip', 'tipo', 'ultimoUsoEn'],
      );
    }
  });

  it('exige autenticación', async () => {
    const r = await pedir('GET', '/api/v1/auth/sessions');
    expect(r.status).toBe(401);
  });
});

describe('#52 · Cerrar una sesión', () => {
  it('el dueño cierra la suya y el token deja de valer AL INSTANTE', async () => {
    const victima = ana.otras[0];

    // Vale antes.
    expect((await pedir('GET', '/api/v1/auth/me', victima.token)).status).toBe(200);

    expect((await pedir('DELETE', `/api/v1/auth/sessions/${victima.id}`, ana.token)).status).toBe(
      204,
    );

    /*
     * Sin invalidar la caché de `authJwt`, esto seguiría dando 200 durante 5
     * segundos. Es una ventana pequeña, pero quien cierra la sesión de un
     * intruso está haciendo justo lo contrario de esperar.
     */
    expect((await pedir('GET', '/api/v1/auth/me', victima.token)).status).toBe(401);
  });

  it('un usuario NO puede cerrar la sesión de otro', async () => {
    const r = await pedir('DELETE', `/api/v1/auth/sessions/${beto.sesionActual}`, ana.token);

    expect(r.status).toBe(404);

    // Y sigue viva de verdad, no solo en la respuesta.
    expect((await pedir('GET', '/api/v1/auth/me', beto.token)).status).toBe(200);
  });

  it('no es un oráculo: el mismo mensaje para ajena que para inexistente', async () => {
    const ajena = await pedir('DELETE', `/api/v1/auth/sessions/${beto.sesionActual}`, ana.token);
    const inventada = await pedir(
      'DELETE',
      '/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000',
      ana.token,
    );

    // Distinguirlos permitiría averiguar qué UUIDs son sesiones reales de otras
    // cuentas, probándolos uno a uno.
    expect(ajena.status).toBe(inventada.status);
    expect(ajena.body.error.message).toBe(inventada.body.error.message);
  });

  it('cerrar dos veces la misma no revienta: 404 la segunda', async () => {
    const s = ana.otras[1];

    expect((await pedir('DELETE', `/api/v1/auth/sessions/${s.id}`, ana.token)).status).toBe(204);
    expect((await pedir('DELETE', `/api/v1/auth/sessions/${s.id}`, ana.token)).status).toBe(404);
  });
});

describe('#52 · Cerrar las demás', () => {
  it('cierra todas menos la propia, y solo las del que pide', async () => {
    const r = await pedir('DELETE', '/api/v1/auth/sessions', ana.token);
    expect(r.status).toBe(200);

    const quedan = await pedir('GET', '/api/v1/auth/sessions', ana.token);
    expect(quedan.body.meta).toEqual({ total: 1, otras: 0 });
    expect(quedan.body.data[0].id).toBe(ana.sesionActual);

    // No echarse a uno mismo es el punto: quien sospecha de un intruso quiere
    // echarlo a él, no quedarse fuera con el intruso dentro.
    expect((await pedir('GET', '/api/v1/auth/me', ana.token)).status).toBe(200);

    // Y las de Beto intactas.
    expect((await pedir('GET', '/api/v1/auth/me', beto.token)).status).toBe(200);
    expect((await pedir('GET', '/api/v1/auth/sessions', beto.token)).body.meta.total).toBe(2);
  });
});

describe('#52 · Lectura del user-agent', () => {
  it.each([
    [UA_WINDOWS, 'Chrome en Windows', 'escritorio'],
    [UA_IPHONE, 'Safari en iOS', 'movil'],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
      'Chrome en Android',
      'movil',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1',
      'Safari en iOS',
      'tablet',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Edge en Linux',
      'escritorio',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/133.0',
      'Firefox en macOS',
      'escritorio',
    ],
  ])('%s → %s', (ua, esperado, tipo) => {
    const r = describirDispositivo(ua);
    expect(r.dispositivo).toBe(esperado);
    expect(r.tipo).toBe(tipo);
  });

  it('Edge y Opera no se confunden con Chrome, ni Chrome con Safari', () => {
    // Los tres mienten en su user-agent por compatibilidad histórica: Edge dice
    // "Chrome", Opera dice "Chrome", y Chrome dice "Safari". Mirar en el orden
    // equivocado etiqueta mal casi todo el tráfico real.
    expect(describirDispositivo('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36 Edg/131.0').dispositivo)
      .toBe('Edge en Windows');
    expect(describirDispositivo('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36 OPR/115.0').dispositivo)
      .toBe('Opera en Windows');
    expect(describirDispositivo(UA_WINDOWS).dispositivo).toBe('Chrome en Windows');
  });

  it('sin user-agent, o con basura, no revienta ni inventa', () => {
    expect(describirDispositivo(null)).toEqual({
      dispositivo: 'Dispositivo desconocido',
      tipo: 'desconocido',
    });
    // El user-agent lo manda el cliente y puede ser cualquier cosa. Lo que no
    // puede es acabar pintado tal cual en la pantalla.
    expect(describirDispositivo('<script>alert(1)</script>')).toEqual({
      dispositivo: 'Dispositivo desconocido',
      tipo: 'desconocido',
    });
  });
});
