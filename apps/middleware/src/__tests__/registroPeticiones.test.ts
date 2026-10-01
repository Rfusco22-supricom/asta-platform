import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey, revokeApiKey } from '../services/apiKey.service.js';
import { regla401PorKey, reglaNMasUno, UMBRALES } from '../services/alerts.service.js';

/**
 * Issue #29 — bitácora de la API pública en `api_request_logs`.
 *
 * Esta tabla existía, tres alertas de #46 la leían, y nada la escribía. Los tests
 * de aquellas alertas siembran filas con `createMany`, así que pasaban igual: lo
 * que nunca se había probado es que el tráfico REAL llegue a la tabla con la forma
 * que las reglas esperan. Eso es lo que prueba este fichero.
 *
 * Contra el servidor, MySQL y Odoo reales. `/invoices` va a Odoo aunque el cliente
 * sea ficticio: la consulta vuelve vacía, pero los RPC se hacen igual, y eso es lo
 * que se mide.
 */

const INICIO = new Date(Date.now() - 1000);
const PARTNER_FICTICIO = 999_000_301;
const EMAIL = 'test.bitacora@registro.local';
const KEY_INVENTADA = `asta_live_deadbeef_${'A'.repeat(43)}`;

let server: Server;
let base = '';
let userId = '';
const keysCreadas: string[] = [];

let buena: { id: string; plaintext: string };
let revocada: { id: string; plaintext: string };

async function get(path: string, key?: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, { headers: key ? { 'X-API-Key': key } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * El último id escrito en la bitácora.
 *
 * Las filas de cada test se separan por id y NO por fecha. La primera versión
 * usaba `const t = new Date()` como frontera, y fallaba de forma intermitente en la
 * suite completa: `created_at` lo pone Prisma y MySQL lo redondea a milisegundos,
 * así que una fila del test anterior podía caer justo en el borde y colarse en el
 * siguiente. Los ids son autoincrementales y estrictamente crecientes: no dependen
 * del reloj.
 */
async function ultimoId(): Promise<bigint> {
  const f = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return f?.id ?? 0n;
}

/** Las filas se escriben DESPUÉS de responder: hay que esperar a que lleguen. */
async function filasTras(idPrevio: bigint, cuantas: number) {
  for (let i = 0; i < 50; i++) {
    const filas = await prisma.apiRequestLog.findMany({
      where: { id: { gt: idPrevio } },
      orderBy: { id: 'asc' },
    });
    if (filas.length >= cuantas) return filas;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`No llegaron ${cuantas} filas a api_request_logs`);
}

async function nuevaKey(opciones: { limite?: number; scopes?: Array<'INVOICES_READ' | 'PRICING_READ'> } = {}) {
  const k = await issueApiKey({
    userId,
    name: 'bitacora',
    scopes: opciones.scopes ?? ['INVOICES_READ', 'PRICING_READ'],
    rateLimitPerMinute: opciones.limite ?? 1000,
  });
  keysCreadas.push(k.id);
  return k;
}

beforeAll(async () => {
  await prisma.appUser.deleteMany({ where: { email: EMAIL } });
  const u = await prisma.appUser.create({
    data: { email: EMAIL, fullName: 'Cliente de prueba (bitácora)', role: 'BRONCE', odooPartnerId: PARTNER_FICTICIO, isActive: true },
  });
  userId = u.id;

  buena = await nuevaKey();
  revocada = await nuevaKey();
  await revokeApiKey({ apiKeyId: revocada.id, actorId: userId, duenoEsperado: userId, reason: 'test' });

  server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  // Las filas de este fichero, para no contaminar las reglas de otros tests.
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#29 · Bitácora: una fila por petición', () => {
  it('una petición deja su fila con todo lo que leen las alertas', async () => {
    // `/pricing` sin `skus`: responde 400 antes de tocar Odoo. Hasta #31 era un
    // 501; lo que importa es que no dependa del ERP.
    const previo = await ultimoId();
    await get('/pricing', buena.plaintext);

    const [f] = await filasTras(previo, 1);
    expect(f).toMatchObject({
      apiKeyId: buena.id,
      odooPartnerId: PARTNER_FICTICIO,
      method: 'GET',
      path: '/api/v1/public/pricing',
      statusCode: 400,
      errorCode: 'INVALID_QUERY',
      odooCalls: 0,
    });
    expect(f.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('guarda la ruta SIN la query string', async () => {
    // La query puede llevar un partner_id ajeno o filtros, y esta tabla la lee
    // operación con el usuario de informes.
    const previo = await ultimoId();
    await get(`/invoices?porPagina=1&partner_id=${PARTNER_FICTICIO}&desde=2020-01-01`, buena.plaintext);

    const [f] = await filasTras(previo, 1);
    expect(f.path).toBe('/api/v1/public/invoices');
  });

  it('cuenta los RPC a Odoo de CADA petición', async () => {
    // Sin esto `odoo_calls` saldría siempre a 0 y la alerta de N+1 no podría
    // saltar nunca. El contador sigue a la petición a través del cliente XML-RPC
    // gracias a AsyncLocalStorage; aquí se comprueba que no se pierde por el camino.
    const previo = await ultimoId();
    await get('/invoices?porPagina=1', buena.plaintext);
    await get('/pricing', buena.plaintext);

    // Por ruta y no por posición: los INSERT corren en paralelo tras cada
    // respuesta, y el de /invoices, que tocó Odoo, puede llegar después.
    const filas = await filasTras(previo, 2);
    const conOdoo = filas.find((f) => f.path === '/api/v1/public/invoices');
    const sinOdoo = filas.find((f) => f.path === '/api/v1/public/pricing');
    expect(conOdoo?.odooCalls).toBeGreaterThanOrEqual(1);
    expect(sinOdoo?.odooCalls).toBe(0);
  });

  it('registra lo que corta el limitador: el 429, con su key', async () => {
    // Es la entrada de la alerta key-429. Si el 429 no llegara a la tabla, o
    // llegara sin key, la regla no tendría nada que contar.
    const limitada = await nuevaKey({ limite: 1, scopes: ['PRICING_READ'] });
    const previo = await ultimoId();
    await get('/pricing', limitada.plaintext);
    expect((await get('/pricing', limitada.plaintext)).status).toBe(429);

    const filas = await filasTras(previo, 2);
    // Por estado y no por posición: el orden de llegada de los INSERT no está
    // garantizado.
    expect(filas.find((f) => f.statusCode === 429)).toMatchObject({
      apiKeyId: limitada.id,
      errorCode: 'RATE_LIMITED',
    });
  });

  it('un 401 de una key revocada se atribuye a esa key', async () => {
    const previo = await ultimoId();
    await get('/invoices', revocada.plaintext);

    const [f] = await filasTras(previo, 1);
    expect(f).toMatchObject({ statusCode: 401, apiKeyId: revocada.id, errorCode: 'INVALID_API_KEY' });
  });

  it('un 401 de una key inventada queda sin key: no es de nadie', async () => {
    const previo = await ultimoId();
    await get('/invoices', KEY_INVENTADA);

    const [f] = await filasTras(previo, 1);
    expect(f).toMatchObject({ statusCode: 401, apiKeyId: null, errorCode: 'INVALID_API_KEY' });
  });

  it('la atribución NO se filtra a la respuesta', async () => {
    // Por dentro se sabe que una iba contra una key real. Por fuera, las dos
    // tienen que ser exactamente el mismo 401.
    const previo = await ultimoId();
    const [deRevocada, deInventada] = await Promise.all([
      get('/invoices', revocada.plaintext),
      get('/invoices', KEY_INVENTADA),
    ]);
    expect(deRevocada.status).toBe(401);
    expect(deRevocada.body).toEqual(deInventada.body);
    // Se esperan sus dos filas: sin esto podían llegar tarde y colarse en el
    // test siguiente.
    await filasTras(previo, 2);
  });

  // "Un fallo al escribir la bitácora no rompe la petición" vive en
  // registroPeticionesErrores.test.ts. Aquí se intentó con `vi.spyOn` sobre
  // `prisma.apiRequestLog`, y restaurar el espía deja roto el delegado de Prisma
  // —es un Proxy—, así que todas las escrituras posteriores fallaban.
});

describe('#29 · Las alertas se disparan con tráfico REAL, sin sembrar', () => {
  /*
   * Lo que faltaba demostrar. Los tests de #46 prueban que las reglas leen bien
   * filas sembradas; estos, que las filas que produce el tráfico de verdad las
   * hacen saltar.
   *
   * `key-429` no está aquí, y no por olvido: exige 429 en varios MINUTOS
   * distintos y un test no puede esperar minutos reales. La cubren los tests de
   * la regla en alerts.test.ts, y el caso de arriba que comprueba que un 429 real
   * llega a la tabla con su key.
   *
   * Cada caso vacía antes la ventana de la regla, para que lo único que pueda
   * dispararla sea la petición que hace el propio test.
   */
  const entornoPrevio = { ...process.env };

  beforeEach(async () => {
    await prisma.apiRequestLog.deleteMany({
      where: { createdAt: { gte: new Date(Date.now() - (UMBRALES.ventanaMin + 1) * 60_000) } },
    });
  });

  afterEach(() => {
    process.env.ALERTA_KEY_401 = entornoPrevio.ALERTA_KEY_401;
    process.env.ALERTA_ODOO_CALLS = entornoPrevio.ALERTA_ODOO_CALLS;
    if (entornoPrevio.ALERTA_KEY_401 === undefined) delete process.env.ALERTA_KEY_401;
    if (entornoPrevio.ALERTA_ODOO_CALLS === undefined) delete process.env.ALERTA_ODOO_CALLS;
  });

  it('key-401 salta con rechazos reales de una key revocada', async () => {
    process.env.ALERTA_KEY_401 = '3';
    const previo = await ultimoId();
    for (let i = 0; i < 3; i++) await get('/invoices', revocada.plaintext);
    await filasTras(previo, 3);

    const a = await regla401PorKey();
    expect(a?.id).toBe('key-401');
    expect(a?.detalle).toContain(revocada.id);
  });

  it('key-401 NO salta por keys inventadas: no pertenecen a nadie', async () => {
    // Esas las frena el límite por IP, no esta alerta, que es por key.
    process.env.ALERTA_KEY_401 = '3';
    const previo = await ultimoId();
    for (let i = 0; i < 5; i++) await get('/invoices', KEY_INVENTADA);
    await filasTras(previo, 5);

    expect(await regla401PorKey()).toBeNull();
  });

  it('odoo-n-mas-uno salta con una petición real que hace varios RPC', async () => {
    // Umbral bajado a 1: `/invoices` hace dos RPC hoy. Con el umbral real no hay
    // ningún endpoint que lo pase, que es lo deseable.
    process.env.ALERTA_ODOO_CALLS = '1';
    const previo = await ultimoId();
    await get('/invoices?porPagina=1', buena.plaintext);
    await filasTras(previo, 1);

    const a = await reglaNMasUno();
    expect(a?.id).toBe('odoo-n-mas-uno');
    expect(a?.detalle).toContain('/api/v1/public/invoices');
  });
});
