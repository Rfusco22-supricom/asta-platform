import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';
import type { ApiScope } from '@asta/shared-types';

/**
 * Issue #29 — rate limiting de la API pública.
 *
 * Contra el servidor real y MySQL real, pero SIN Odoo: casi todo va contra
 * `/inventory`, que responde 501 sin consultar el ERP. Así los tests son rápidos y
 * lo único que se mide es el limitador.
 *
 * Cada test levanta su propia app. Los limitadores se crean por app
 * (`crearLimitadoresPublicos`), así que un test no hereda las peticiones de otro.
 */

const PARTNER_FICTICIO = 999_000_201;
/** Desde #29 la API pública escribe `api_request_logs`: se borran al terminar. */
const INICIO = new Date(Date.now() - 1000);
const EMAIL = 'test.ratelimit@limites.local';
const KEY_INVENTADA = `asta_live_deadbeef_${'A'.repeat(43)}`;

let userId = '';
const keysCreadas: string[] = [];

async function key(opciones: { limite: number; scopes?: ApiScope[] }) {
  const k = await issueApiKey({
    userId,
    name: `rate limit ${opciones.limite}`,
    scopes: opciones.scopes ?? ['INVENTORY_READ'],
    rateLimitPerMinute: opciones.limite,
  });
  keysCreadas.push(k.id);
  return k;
}

async function nuevaApp() {
  const server: Server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  const base = `http://127.0.0.1:${dir.port}/api/v1/public`;

  const get = async (path: string, apiKey?: string) => {
    const res = await fetch(base + path, { headers: apiKey ? { 'X-API-Key': apiKey } : {} });
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { status: res.status, headers: res.headers, body };
  };
  const cerrar = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { get, cerrar };
}

beforeAll(async () => {
  await prisma.appUser.deleteMany({ where: { email: EMAIL } });
  const u = await prisma.appUser.create({
    data: {
      email: EMAIL,
      fullName: 'Cliente de prueba (rate limit)',
      role: 'BRONCE',
      odooPartnerId: PARTNER_FICTICIO,
      isActive: true,
    },
  });
  userId = u.id;
});

afterAll(async () => {
  // Sin esto, los 401, 429 y 501 de este fichero quedarían en la ventana de las
  // alertas y harían saltar —o callar— las reglas de alerts.test.ts.
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#29 · Límite por API key', () => {
  it('una key corta exactamente en su límite', async () => {
    const app = await nuevaApp();
    try {
      const k = await key({ limite: 3 });
      const estados: number[] = [];
      for (let i = 0; i < 4; i++) estados.push((await app.get('/inventory', k.plaintext)).status);

      expect(estados).toEqual([501, 501, 501, 429]);
    } finally {
      await app.cerrar();
    }
  });

  it('el límite sale de la propia key, no de una constante', async () => {
    // Dos keys con límites distintos en la misma app: cada una corta en el suyo.
    const app = await nuevaApp();
    try {
      const [dos, cinco] = await Promise.all([key({ limite: 2 }), key({ limite: 5 })]);

      const deDos: number[] = [];
      const deCinco: number[] = [];
      for (let i = 0; i < 3; i++) deDos.push((await app.get('/inventory', dos.plaintext)).status);
      for (let i = 0; i < 6; i++) deCinco.push((await app.get('/inventory', cinco.plaintext)).status);

      expect(deDos).toEqual([501, 501, 429]);
      expect(deCinco).toEqual([501, 501, 501, 501, 501, 429]);
    } finally {
      await app.cerrar();
    }
  });

  it('por key y NO por IP: agotar una key no afecta a otra que sale de la misma IP', async () => {
    // Es el requisito central del issue. Todas las peticiones de este test salen
    // de 127.0.0.1, igual que dos clientes detrás de la misma IP corporativa.
    const app = await nuevaApp();
    try {
      const [abusona, vecina] = await Promise.all([key({ limite: 2 }), key({ limite: 2 })]);

      for (let i = 0; i < 3; i++) await app.get('/inventory', abusona.plaintext);
      expect((await app.get('/inventory', abusona.plaintext)).status).toBe(429);

      expect((await app.get('/inventory', vecina.plaintext)).status).toBe(501);
    } finally {
      await app.cerrar();
    }
  });

  it('cambiar el límite en la base tiene efecto en la siguiente petición', async () => {
    // Se lee de la identidad, que sale de la fila de la key en cada verificación.
    // No hace falta reiniciar para subirle o bajarle el límite a un cliente.
    const app = await nuevaApp();
    try {
      const k = await key({ limite: 2 });
      await app.get('/inventory', k.plaintext);
      await app.get('/inventory', k.plaintext);
      expect((await app.get('/inventory', k.plaintext)).status).toBe(429);

      await prisma.apiKey.update({ where: { id: k.id }, data: { rateLimitPerMinute: 10 } });
      expect((await app.get('/inventory', k.plaintext)).status).toBe(501);
    } finally {
      await app.cerrar();
    }
  });

  it('también cuentan los rechazos de una key válida', async () => {
    // El limitador va ANTES de `requireScope` y `scopeToOwnPartner`: probar
    // partner_id o scopes con una key válida no puede salir gratis.
    const app = await nuevaApp();
    try {
      const sinScope = await key({ limite: 3, scopes: ['PRICING_READ'] });

      const estados = [
        (await app.get('/inventory', sinScope.plaintext)).status, // 403: sin INVENTORY_READ
        (await app.get('/inventory?partner_id=1', sinScope.plaintext)).status, // 400: partner ajeno
        (await app.get('/inventory', sinScope.plaintext)).status, // 403
        (await app.get('/inventory', sinScope.plaintext)).status, // ya no llega: 429
      ];
      expect(estados).toEqual([403, 400, 403, 429]);
    } finally {
      await app.cerrar();
    }
  });
});

describe('#29 · Cabeceras', () => {
  it('cada respuesta lleva RateLimit-Limit, -Remaining y -Reset', async () => {
    const app = await nuevaApp();
    try {
      const k = await key({ limite: 5 });
      const primera = await app.get('/inventory', k.plaintext);
      const segunda = await app.get('/inventory', k.plaintext);

      expect(primera.headers.get('ratelimit-limit')).toBe('5');
      expect(primera.headers.get('ratelimit-remaining')).toBe('4');
      expect(segunda.headers.get('ratelimit-remaining')).toBe('3');
      expect(Number(primera.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
    } finally {
      await app.cerrar();
    }
  });

  it('el 429 lleva Retry-After y un cuerpo con código', async () => {
    const app = await nuevaApp();
    try {
      const k = await key({ limite: 1 });
      await app.get('/inventory', k.plaintext);
      const r = await app.get('/inventory', k.plaintext);

      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(r.body?.error?.code).toBe('RATE_LIMITED');
    } finally {
      await app.cerrar();
    }
  });
});

describe('#29 · Antes de autenticar: probar keys no sale gratis', () => {
  it('una IP que acumula 401 acaba recibiendo 429', async () => {
    // Sin este limitador, cada key inventada paga la verificación contra la base y
    // se responde 401 indefinidamente: probar keys al azar no cuesta nada.
    const app = await nuevaApp();
    try {
      const estados: number[] = [];
      for (let i = 0; i < 51; i++) estados.push((await app.get('/inventory', KEY_INVENTADA)).status);

      expect(estados.slice(0, 50).every((s) => s === 401)).toBe(true);
      expect(estados[50]).toBe(429);
    } finally {
      await app.cerrar();
    }
  });

  it('el tráfico correcto de una IP compartida no suma', async () => {
    // Solo cuentan los 401. Un cliente sano que comparte IP con otros no debe
    // acercarse al límite de fallos por hacer su trabajo.
    const app = await nuevaApp();
    try {
      const k = await key({ limite: 500 });
      for (let i = 0; i < 60; i++) {
        expect((await app.get('/inventory', k.plaintext)).status).toBe(501);
      }
      expect((await app.get('/inventory', KEY_INVENTADA)).status).toBe(401);
    } finally {
      await app.cerrar();
    }
  });

  it('coste asumido: una IP bloqueada recibe 429 también con una key válida', async () => {
    // Este limitador va antes de verificar la key y no puede saber si es buena.
    // Es deliberado, y está fijado aquí para que nadie lo descubra en producción
    // pensando que es un bug: por eso el umbral es alto.
    const app = await nuevaApp();
    try {
      const buena = await key({ limite: 500 });
      for (let i = 0; i < 50; i++) await app.get('/inventory', KEY_INVENTADA);

      expect((await app.get('/inventory', buena.plaintext)).status).toBe(429);
    } finally {
      await app.cerrar();
    }
  });
});
