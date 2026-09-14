import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { prisma } from '../config/prisma.js';
import { issueApiKey } from '../services/apiKey.service.js';

/**
 * Issue #36 — GATE DE SEGURIDAD: aislamiento entre clientes de la API pública.
 *
 * El otro gate del proyecto, junto a #25. Aquel protege la cartera de un
 * vendedor frente a otro; este, los datos de un cliente frente a otro cliente.
 * Sin el RLS de Supabase, el scoping del middleware es la única línea de
 * defensa, y estos tests lo único que la vigila.
 *
 * Según `docs/03-REPARTO.md` §5 este issue NO se cierra sin la revisión cruzada
 * del Track A. Que estos tests pasen lo afirma quien los escribió, que es
 * precisamente quien menos debe certificarlo.
 *
 * ── Qué cubre y qué no ───────────────────────────────────────────────────────
 *
 * Cubre las tareas de #36 que tienen ya un endpoint sobre el que probarse:
 *
 *   ✓ key de A con `?partner_id=<B>`                → 400, nunca datos de B
 *   ✓ key de A pidiendo la factura de B por id      → 404, nunca 200
 *   ✓ cada intento cruzado queda en la auditoría
 *
 * Quedan pendientes las que dependen de endpoints sin implementar:
 *
 *   · pedidos de B por id, y crear un pedido a nombre de B   (#33)
 *   · key BRONCE forzando la tarifa GOLD                     (#31)
 *
 * ── Por qué contra Odoo real ─────────────────────────────────────────────────
 *
 * Por lo mismo que #25: con datos inventados se prueba el caso que uno ya tenía
 * en la cabeza. Los clientes se descubren de la instancia, y el contenido de lo
 * que SÍ se autoriza se contrasta contra Odoo, factura a factura. Un 404 bien
 * puesto no demuestra que un 200 no esté filtrando.
 */

/** Desde #29 la API pública escribe `api_request_logs`: se borran al terminar. */
const INICIO = new Date(Date.now() - 1000);

let server: Server;
let base = '';
const auditados: AuditEvent[] = [];
let quitarSink: () => void;

interface Cliente {
  partnerId: number;
  userId: string;
  key: string;
  keyId: string;
  /** Una factura suya, contabilizada. */
  factura: number;
}

let A: Cliente;
let B: Cliente;
/** Key de A SIN el scope INVOICES_READ. */
let keySinScope = '';

const usuariosCreados: string[] = [];
const keysCreadas: string[] = [];

async function get(path: string, key?: string) {
  const res = await fetch(`${base}/api/v1/public${path}`, {
    headers: key ? { 'X-API-Key': key } : {},
  });
  const body = (await res.json().catch(() => null)) as {
    data?: unknown;
    meta?: { total: number; pagina: number; porPagina: number };
    error?: { code?: string };
  } | null;
  return { status: res.status, body };
}

/**
 * Dos clientes RAÍZ de árboles distintos, cada uno con facturas contabilizadas.
 *
 * Raíz, y no un partner cualquiera con facturas: el servicio usa
 * `partner_id child_of`, y si uno colgara del otro, el de arriba vería
 * legítimamente las facturas del de abajo. El test acabaría midiendo la
 * jerarquía, no el aislamiento.
 */
async function descubrirClientes(): Promise<[number, number]> {
  const grupos = await readGroup<{ partner_id: [number, string] | false; __count: number }>(
    'account.move',
    [
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
    ],
    [],
    ['partner_id'],
  );

  const ids = grupos
    .filter((g) => g.partner_id)
    .sort((a, b) => b.__count - a.__count)
    .slice(0, 60)
    .map((g) => (g.partner_id as [number, string])[0]);

  const partners = await searchRead<{ id: number; commercial_partner_id: [number, string] | false }>(
    'res.partner',
    [['id', 'in', ids]],
    ['id', 'commercial_partner_id'],
  );
  const raices = new Set(
    partners
      .filter((p) => !p.commercial_partner_id || p.commercial_partner_id[0] === p.id)
      .map((p) => p.id),
  );

  const elegidos = ids.filter((id) => raices.has(id)).slice(0, 2);
  if (elegidos.length < 2) {
    throw new Error('Hacen falta dos clientes raíz con facturas contabilizadas.');
  }
  return [elegidos[0], elegidos[1]];
}

async function prepararCliente(partnerId: number, sufijo: string): Promise<Cliente> {
  // odoo_partner_id es UNIQUE: si el sync de #15 ya creó la fila, se reutiliza y
  // al terminar solo se borran las keys, no el usuario.
  let usuario = await prisma.appUser.findUnique({ where: { odooPartnerId: partnerId } });
  if (usuario && !['BRONCE', 'PLATA', 'GOLD'].includes(usuario.role)) {
    throw new Error(`El partner ${partnerId} ya pertenece a un usuario con rol ${usuario.role}.`);
  }
  if (!usuario) {
    usuario = await prisma.appUser.create({
      data: {
        email: `test.api.${sufijo}@aislamiento.local`,
        fullName: `Cliente de prueba ${sufijo}`,
        role: 'BRONCE',
        odooPartnerId: partnerId,
        isActive: true,
      },
    });
    usuariosCreados.push(usuario.id);
  }

  const emitida = await issueApiKey({ userId: usuario.id, name: `gate 36 ${sufijo}`, scopes: ['INVOICES_READ'] });
  keysCreadas.push(emitida.id);

  const [factura] = await searchRead<{ id: number }>(
    'account.move',
    [
      ['partner_id', 'child_of', partnerId],
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
    ],
    ['id'],
    { limit: 1, order: 'id desc' },
  );
  if (!factura) throw new Error(`El cliente ${partnerId} no tiene facturas: el test no probaría nada.`);

  return { partnerId, userId: usuario.id, key: emitida.plaintext, keyId: emitida.id, factura: factura.id };
}

/** Todas las facturas que la API le devuelve a una key, recorriendo las páginas. */
async function todasLasFacturas(key: string, extra = ''): Promise<number[]> {
  const ids: number[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await get(`/invoices?porPagina=100&pagina=${pagina}${extra}`, key);
    expect(r.status).toBe(200);
    const data = r.body?.data as Array<{ id: number }>;
    ids.push(...data.map((f) => f.id));
    if (data.length < 100 || ids.length >= (r.body?.meta?.total ?? 0)) break;
  }
  return ids;
}

/** De qué cliente raíz es cada factura, según Odoo — no según la API. */
async function duenioSegunOdoo(ids: number[]): Promise<Map<number, number>> {
  const filas = await searchRead<{ id: number; commercial_partner_id: [number, string] | false }>(
    'account.move',
    [['id', 'in', ids]],
    ['id', 'commercial_partner_id'],
  );
  return new Map(filas.map((f) => [f.id, f.commercial_partner_id ? f.commercial_partner_id[0] : 0]));
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  quitarSink = registerAuditSink((e) => auditados.push(e));

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  const [pA, pB] = await descubrirClientes();
  A = await prepararCliente(pA, 'a');
  B = await prepararCliente(pB, 'b');

  const sinScope = await issueApiKey({ userId: A.userId, name: 'gate 36 sin scope', scopes: ['INVENTORY_READ'] });
  keysCreadas.push(sinScope.id);
  keySinScope = sinScope.plaintext;
});

afterAll(async () => {
  quitarSink?.();
  // Las filas de bitácora de este fichero, para no contaminar las reglas de
  // alerts.test.ts.
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#36 · Listado: cada key ve solo lo suyo', () => {
  it('TODAS las facturas que recibe A son de A, según Odoo', async () => {
    // No basta con que el listado responda 200. Se contrasta cada factura contra
    // Odoo: es la forma que tendría una fuga que ningún 403 delata.
    const ids = await todasLasFacturas(A.key);
    expect(ids.length).toBeGreaterThan(0);

    const duenio = await duenioSegunOdoo(ids);
    const ajenas = ids.filter((id) => duenio.get(id) !== A.partnerId);
    expect(ajenas).toEqual([]);
  });

  it('los listados de A y de B no comparten ni una factura', async () => {
    const [deA, deB] = await Promise.all([todasLasFacturas(A.key), todasLasFacturas(B.key)]);
    const setA = new Set(deA);
    expect(deB.filter((id) => setA.has(id))).toEqual([]);
    expect(deA).not.toContain(B.factura);
    expect(deB).not.toContain(A.factura);
  });

  it('filtrar por estado de pago no abre la puerta a otro cliente', async () => {
    // Cada filtro es una rama del dominio que se construye aparte: se comprueba
    // que ninguna pierde el cliente por el camino.
    //
    // El estado se elige entre los que A TIENE, en vez de fijar 'paid': con un
    // estado que A no tuviera, el listado saldría vacío y el test pasaría sin
    // haber probado nada. Es el mismo fallo que la revisión de #25 encontró en
    // tres tests de aquel gate.
    const [grupo] = await readGroup<{ payment_state: string | false; __count: number }>(
      'account.move',
      [
        ['commercial_partner_id', '=', A.partnerId],
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['payment_state', '!=', false],
      ],
      [],
      ['payment_state'],
    );
    if (!grupo?.payment_state) {
      throw new Error('Las facturas de A no tienen estado de pago: el filtro queda SIN PROBAR.');
    }

    const ids = await todasLasFacturas(A.key, `&estadoPago=${grupo.payment_state}`);
    expect(ids.length).toBe(grupo.__count);

    const duenio = await duenioSegunOdoo(ids);
    expect(ids.filter((id) => duenio.get(id) !== A.partnerId)).toEqual([]);
  });

  it('el total del listado coincide con lo que Odoo le atribuye a A', async () => {
    const r = await get('/invoices?porPagina=1', A.key);
    const enOdoo = await searchRead<{ id: number }>(
      'account.move',
      [
        ['commercial_partner_id', '=', A.partnerId],
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
      ],
      ['id'],
    );
    expect(r.body?.meta?.total).toBe(enOdoo.length);
  });
});

describe('#36 · Detalle: una factura ajena no existe', () => {
  it('A ve su propia factura', async () => {
    const r = await get(`/invoices/${A.factura}`, A.key);
    expect(r.status).toBe(200);
    expect((r.body?.data as { id: number }).id).toBe(A.factura);
  });

  it('A pidiendo la factura de B por id recibe 404, nunca 200', async () => {
    const r = await get(`/invoices/${B.factura}`, A.key);
    expect(r.status).toBe(404);
    expect(r.body?.data).toBeUndefined();
  });

  it('y B pidiendo la de A, igual', async () => {
    const r = await get(`/invoices/${A.factura}`, B.key);
    expect(r.status).toBe(404);
  });

  it('una factura ajena y una inexistente responden EXACTAMENTE igual', async () => {
    // Un 403 sobre la ajena le confirmaría a quien prueba ids que ese id existe y
    // es de alguien. Con ids consecutivos, eso es enumerar la facturación.
    const [ajena, inexistente] = await Promise.all([
      get(`/invoices/${B.factura}`, A.key),
      get('/invoices/999999999', A.key),
    ]);
    expect(ajena.status).toBe(inexistente.status);
    expect(ajena.body).toEqual(inexistente.body);
  });
});

describe('#36 · El cliente no puede elegir el partner_id', () => {
  it('?partner_id de otro cliente → 400, sin datos', async () => {
    const r = await get(`/invoices?partner_id=${B.partnerId}`, A.key);
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('PARTNER_ID_NOT_ALLOWED');
    expect(r.body?.data).toBeUndefined();
  });

  it('?partner_id propio se acepta', async () => {
    const r = await get(`/invoices?partner_id=${A.partnerId}&porPagina=1`, A.key);
    expect(r.status).toBe(200);
  });

  it('repetir el parámetro (?partner_id=A&partner_id=B) → 400', async () => {
    // Contaminación de parámetros: Express convierte el repetido en un array. Si
    // algo leyera "el primero", pasaría el propio y colaría el ajeno.
    const r = await get(`/invoices?partner_id=${A.partnerId}&partner_id=${B.partnerId}`, A.key);
    expect(r.status).toBe(400);
  });

  it('el partner_id tampoco se cuela en el detalle', async () => {
    const r = await get(`/invoices/${B.factura}?partner_id=${B.partnerId}`, A.key);
    expect(r.status).toBe(400);
  });
});

describe('#36 · Rastro de auditoría', () => {
  const eventosDenegados = () => auditados.filter((e) => e.action === 'access.denied.partner');

  it('pedir la factura de otro cliente queda registrado', async () => {
    const antes = eventosDenegados().length;
    await get(`/invoices/${B.factura}`, A.key);

    const nuevos = eventosDenegados().slice(antes);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({
      actorId: A.userId,
      targetType: 'account.move',
      targetId: String(B.factura),
      metadata: { via: 'api_key', apiKeyId: A.keyId, partnerDelToken: A.partnerId },
    });
  });

  it('forzar el partner_id de otro cliente queda registrado', async () => {
    const antes = eventosDenegados().length;
    await get(`/invoices?partner_id=${B.partnerId}`, A.key);

    const nuevos = eventosDenegados().slice(antes);
    expect(nuevos).toHaveLength(1);
    expect(nuevos[0]).toMatchObject({
      actorId: A.userId,
      targetType: 'res.partner',
      targetId: String(B.partnerId),
      metadata: { via: 'api_key', apiKeyId: A.keyId },
    });
  });

  it('pedir una factura que no existe NO es un intento cruzado', async () => {
    // Lo contrario llenaría la auditoría de ruido: un id mal tecleado no es un
    // ataque, y un sistema que alerta por todo acaba sin que nadie lo mire (#46).
    const antes = eventosDenegados().length;
    await get('/invoices/999999999', A.key);
    expect(eventosDenegados().length).toBe(antes);
  });

  it('un acceso legítimo NO genera evento de denegación', async () => {
    const antes = auditados.filter((e) => e.action.startsWith('access.denied')).length;
    await get(`/invoices/${A.factura}`, A.key);
    await get('/invoices?porPagina=1', A.key);
    expect(auditados.filter((e) => e.action.startsWith('access.denied')).length).toBe(antes);
  });
});

describe('#36 · Autenticación y scopes', () => {
  it('sin API key → 401', async () => {
    const r = await get('/invoices');
    expect(r.status).toBe(401);
  });

  it('una key sin INVOICES_READ → 403, aunque sea de un cliente con facturas', async () => {
    const r = await get('/invoices', keySinScope);
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('un id de factura mal formado → 400', async () => {
    const r = await get('/invoices/abc', A.key);
    expect(r.status).toBe(400);
  });
});
