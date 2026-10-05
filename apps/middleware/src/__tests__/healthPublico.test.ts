import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { odooEnv } from '../config/odooEnv.js';

/**
 * `/health` se sirve sin autenticar, y desde el 2026-10-05 a todo internet: el
 * dominio público del middleware empezó a responder.
 *
 * Lo que se vigila: que no diga contra qué Odoo ni contra qué base trabajamos, y
 * que siga dando lo que leen la alerta (`cli/alertas.ts`) y los runbooks: el
 * estado, cada dependencia y la latencia de Odoo.
 */

let server: Server;
let base = '';

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('/health, público', () => {
  it('no dice la URL ni la base de Odoo', async () => {
    const res = await fetch(`${base}/health`);
    const texto = await res.text();
    expect(texto).not.toContain(new URL(odooEnv.ODOO_URL).hostname);
    expect(texto).not.toContain(odooEnv.ODOO_DB);
  });

  it('sigue dando el estado, cada dependencia y la latencia de Odoo', async () => {
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as {
      status: string;
      dependencias: { odoo: { ok: boolean; latencia: { muestras: number } }; mysql: { ok: boolean } };
    };
    expect(['ok', 'degraded']).toContain(body.status);
    expect(typeof body.dependencias.odoo.ok).toBe('boolean');
    expect(typeof body.dependencias.mysql.ok).toBe('boolean');
    expect(typeof body.dependencias.odoo.latencia.muestras).toBe('number');
  });
});
