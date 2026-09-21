import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { PublicPrinterSearchResponse } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { issueApiKey } from '../services/apiKey.service.js';
import { vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * Revisión de #111/#112 · Lo que se crea sin revisar no es público.
 *
 * Un VENDEDOR que propone «a esta impresora le sirve este cartucho» crea la
 * impresora si no existe. La compatibilidad nacía PROPUESTA, pero la impresora
 * entraba activa en el catálogo público del recomendador (#108) al instante.
 * Comprobado antes del arreglo: «Visita www.ejemplo-falso.com 4455», propuesta
 * por un vendedor, salía en el buscador de cualquier cliente con API key.
 *
 * El camino completo, por HTTP: propone el vendedor → no se ve ni en la búsqueda
 * ni por id → valida un administrador en el panel → se ve.
 */

const MARCA = 'ZZ_CAT_MARCA';
const MODELO = 'Visita www.ejemplo-falso.com 4455';

let server: Server;
let base = '';
let comprobado = false;
let idBitacoraInicial = 0n;
const usuarios: string[] = [];
const keys: string[] = [];
const tokens = { admin: '', vendedor: '' };
let keyCliente = '';

async function usuario(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({
    data: { email: `test.cat.${sufijo}@catalogo.local`, fullName: `Catálogo ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true },
  });
  usuarios.push(u.id);
  return u;
}

async function token(u: { id: string; role: 'SUPERADMIN' | 'VENDEDOR'; odooPartnerId: number }) {
  const s = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`cat-${u.id}-${Math.random()}`), expiresAt: caducaEnDias(1) },
  });
  return emitirAccessToken({ sub: u.id, role: u.role, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: s.id });
}

async function panel<B>(metodo: string, ruta: string, quien: keyof typeof tokens, cuerpo?: unknown) {
  const res = await fetch(`${base}/api/v1${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokens[quien]}`, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json()) as B };
}

async function publica<B>(ruta: string) {
  vaciarCachesRecomendador();
  const res = await fetch(`${base}/api/v1/public${ruta}`, { headers: { 'X-API-Key': keyCliente } });
  return { status: res.status, body: (await res.json()) as B };
}

beforeAll(async () => {
  const restos =
    (await prisma.printerBrand.count({ where: { name: MARCA } })) + (await prisma.appUser.count({ where: { email: { endsWith: '@catalogo.local' } } }));
  if (restos) throw new Error(`Restos de ${MARCA} en la base: límpialos a mano.`);
  comprobado = true;
  // Las peticiones públicas dejan filas en api_request_logs; alerts.test.ts
  // cuenta esa tabla, así que se borran al terminar.
  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  const admin = await usuario('SUPERADMIN', 'admin', 3_910_000_001);
  const vendedor = await usuario('VENDEDOR', 'vendedor', 3_910_000_002);
  // El cliente tiene que ser real: `/compatible` resuelve su almacén en Odoo.
  const ocupados = new Set((await prisma.appUser.findMany({ select: { odooPartnerId: true } })).map((u) => u.odooPartnerId));
  const candidatos = await searchRead<{ id: number }>(
    'res.partner',
    [['company_id', '=', 10], ['customer_rank', '>', 0], ['parent_id', '=', false]],
    ['id'],
    { limit: 300, order: 'id' },
  );
  const partnerCliente = candidatos.find((c) => !ocupados.has(c.id))?.id;
  if (!partnerCliente) throw new Error('No hay un cliente libre de la compañía 10.');
  const cliente = await usuario('BRONCE', 'cliente', partnerCliente);
  tokens.admin = await token({ id: admin.id, role: 'SUPERADMIN', odooPartnerId: admin.odooPartnerId });
  tokens.vendedor = await token({ id: vendedor.id, role: 'VENDEDOR', odooPartnerId: vendedor.odooPartnerId });
  const k = await issueApiKey({ userId: cliente.id, name: 'catálogo', scopes: ['RECOMMENDER_READ'], rateLimitPerMinute: 1000 });
  keys.push(k.id);
  keyCliente = k.plaintext;
}, 60_000);

afterAll(async () => {
  if (comprobado) {
    await prisma.cartridge.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: keys } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('Revisión #111/#112 · Una propuesta de vendedor no es pública hasta que se valida', () => {
  let printerModelId = 0;
  let cartridgeId = 0;

  it('el vendedor propone, y la impresora NO sale en el buscador ni por id', async () => {
    const p = await panel<{ data: { printerModelId: number; cartridgeId: number; estado: string; impresoraNueva: boolean } }>(
      'POST',
      '/salesperson/compatibilidades',
      'vendedor',
      { marcaImpresora: MARCA, modeloImpresora: MODELO, codigoCartucho: 'ZZCAT-1' },
    );
    expect(p.status).toBe(201);
    expect([p.body.data.estado, p.body.data.impresoraNueva]).toEqual(['PROPUESTA', true]);
    ({ printerModelId, cartridgeId } = p.body.data);

    const busqueda = await publica<PublicPrinterSearchResponse>('/recommender/printers?q=4455');
    expect([...busqueda.body.data, ...busqueda.body.sugerencias].map((x) => x.id)).not.toContain(printerModelId);

    const porId = await publica<unknown>(`/recommender/printers/${printerModelId}/compatible`);
    const inexistente = await publica<unknown>('/recommender/printers/4000000000/compatible');
    expect(porId.status).toBe(404);
    expect(porId.body).toEqual(inexistente.body);
  });

  it('un administrador la valida en el panel, y entonces sí es pública', async () => {
    const v = await panel<{ data: { actualizadas: number } }>('POST', '/admin/compatibilidades/impresoras/revision', 'admin', {
      filas: [{ cartridgeId, printerModelId, estadoEsperado: 'PROPUESTA' }],
      decision: 'VALIDADA',
    });
    expect(v.status).toBe(200);
    expect(v.body.data.actualizadas).toBe(1);

    const busqueda = await publica<PublicPrinterSearchResponse>('/recommender/printers?q=4455');
    expect(busqueda.body.data.map((x) => x.id)).toContain(printerModelId);
    expect((await publica<unknown>(`/recommender/printers/${printerModelId}/compatible`)).status).toBe(200);
  });
});
