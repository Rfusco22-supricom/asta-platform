import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { ImpulsaRespuesta } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { idsDeCartera } from '../services/partners.service.js';
import { MARCA_ASTA } from '../services/asta.service.js';
import {
  MONTO_MINIMO,
  aplicarMarcas,
  construirSugerencias,
  sugerenciasPasale,
  vaciarCachePasale,
  type AstaConStock,
  type FichaConsumible,
  type GrupoConsumible,
} from '../services/impulsa/pasaleAAsta.service.js';

/**
 * «Impulsa a tus clientes» · «Pásale a ASTA».
 *
 * La regla y las marcas se prueban con datos hechos a mano. El camino entero
 * —sugerencias, marcar, deshacer, y que nadie marque clientes de otro— por
 * HTTP contra la instancia (solo lectura en Odoo) y la base local.
 */

const HOY = '2026-10-05';

const g = (product: [number, string], partner: [number, string], balance: number, quantity: number, ultima: string, move_type = 'out_invoice', facturas = 1): GrupoConsumible => ({
  product_id: product,
  partner_id: partner,
  move_type,
  balance,
  quantity,
  ultima,
  facturas,
});

const HP_230A: [number, string] = [20, '[W2300A] HP TONER 230A BLACK ORIGINAL'];
const HP_230A_Y: [number, string] = [21, '[W2302A] HP TONER 230A YELLOW ORIGINAL'];
const ASTA_230A: [number, string] = [30, '[A-W2300A-BK] ASTA TONER HP W2300A NEGRO'];
const ANA: [number, string] = [500, 'ANA C.A. '];
const BETO: [number, string] = [501, 'BETO S.R.L.'];

const fichas: FichaConsumible[] = [
  { id: 20, name: 'HP TONER 230A BLACK ORIGINAL', default_code: 'W2300A', spiff_brand_id: [3, 'HP'] },
  { id: 21, name: 'HP TONER 230A YELLOW ORIGINAL', default_code: 'W2302A', spiff_brand_id: [3, 'HP'] },
  { id: 30, name: 'ASTA TONER HP W2300A NEGRO', default_code: 'A-W2300A-BK', spiff_brand_id: [MARCA_ASTA, 'ASTA'] },
];
const catalogo: AstaConStock[] = [
  { id: 30, name: 'ASTA TONER HP W2300A NEGRO', default_code: 'A-W2300A-BK', free_qty: 3 },
  { id: 31, name: 'ASTA TONER HP W2302A YELLOW', default_code: 'A-W2302A-Y', free_qty: 0 },
];

describe('la regla de «Pásale a ASTA»', () => {
  it('sugiere el ASTA del mismo cartucho y color, con existencias', () => {
    const r = construirSugerencias([g(HP_230A, ANA, -500, 4, '2026-09-07')], fichas, () => catalogo, HOY);
    expect(r).toHaveLength(1);
    expect(r[0]!.nombre).toBe('ANA C.A.');
    expect(r[0]!.sugerencias[0]).toMatchObject({
      clave: '20',
      original: { productId: 20, sku: 'W2300A', monto: 500, cantidad: 4, facturas: 1, ultimaCompra: '2026-09-07' },
      asta: [{ productId: 30, sku: 'A-W2300A-BK', disponible: 3 }],
    });
  });

  it('sin existencias del ASTA equivalente, no se sugiere', () => {
    expect(construirSugerencias([g(HP_230A_Y, ANA, -500, 4, '2026-09-07')], fichas, () => catalogo, HOY)).toEqual([]);
  });

  it(`por debajo de ${MONTO_MINIMO}, o sin compra en 180 días, no se sugiere`, () => {
    expect(construirSugerencias([g(HP_230A, ANA, -99, 1, '2026-09-07')], fichas, () => catalogo, HOY)).toEqual([]);
    expect(construirSugerencias([g(HP_230A, ANA, -500, 4, '2026-03-01')], fichas, () => catalogo, HOY)).toEqual([]);
  });

  it('las devoluciones restan: si lo devolvió casi todo, ya no llega al mínimo', () => {
    const r = construirSugerencias([g(HP_230A, ANA, -500, 4, '2026-09-07'), g(HP_230A, ANA, 450, 3, '2026-09-10', 'out_refund')], fichas, () => catalogo, HOY);
    expect(r).toEqual([]);
  });

  it('si ya compra ese ASTA, no hay nada que pasarle', () => {
    const r = construirSugerencias([g(HP_230A, ANA, -500, 4, '2026-09-07'), g(ASTA_230A, ANA, -60, 1, '2026-08-01')], fichas, () => catalogo, HOY);
    expect(r).toEqual([]);
  });

  it('cada cliente con su catálogo: el de otro almacén sin existencias no recibe la sugerencia', () => {
    const r = construirSugerencias(
      [g(HP_230A, ANA, -500, 4, '2026-09-07'), g(HP_230A, BETO, -800, 6, '2026-09-20')],
      fichas,
      (partnerId) => (partnerId === ANA[0] ? catalogo : []),
      HOY,
    );
    expect(r.map((c) => c.nombre)).toEqual(['ANA C.A.']);
  });
});

describe('lo que hizo el vendedor', () => {
  const base = construirSugerencias([g(HP_230A, ANA, -500, 4, '2026-09-07')], fichas, () => catalogo, HOY);
  const marca = (estado: 'ACTIVA' | 'HECHA' | 'POSPUESTA', extra: { hasta?: Date | null; firma?: string | null } = {}) => [
    { odooPartnerId: 500, clave: '20', estado, hasta: extra.hasta ?? null, firma: extra.firma ?? null },
  ];
  const visible = (marcas: ReturnType<typeof marca>, hoy = HOY) => aplicarMarcas(base, marcas, hoy)[0]!.sugerencias[0]!.visible;

  it('sin marca, se ve; HECHA, no, hasta que vuelva a comprar el original', () => {
    expect(visible([])).toBe(true);
    expect(visible(marca('HECHA', { firma: '2026-09-07' }))).toBe(false);
    expect(visible(marca('HECHA', { firma: '2026-08-01' }))).toBe(true); // compró después de marcarla
  });

  it('POSPUESTA no se ve hasta su fecha; ACTIVA es «deshacer»', () => {
    const hasta = new Date('2026-10-12T00:00:00Z');
    expect(visible(marca('POSPUESTA', { hasta }))).toBe(false);
    expect(visible(marca('POSPUESTA', { hasta }), '2026-10-12')).toBe(true);
    expect(visible(marca('ACTIVA'))).toBe(true);
    expect(aplicarMarcas(base, marca('ACTIVA'), HOY)[0]!.sugerencias[0]!.marca).toBeNull();
  });

  it('«en juego» suma solo las visibles', () => {
    expect(aplicarMarcas(base, [], HOY)[0]!.enJuego).toBe(500);
    expect(aplicarMarcas(base, marca('HECHA', { firma: '2026-09-07' }), HOY)[0]!.enJuego).toBe(0);
  });
});

// ── Por HTTP, contra la instancia ──────────────────────────────────────────

let server: Server;
let baseUrl = '';
let comprobado = false;
let idBitacoraInicial = 0n;
const usuarios: string[] = [];
const tokens = { vendedor: '', admin: '' };
let vendedorOdoo = 0;
let vendedorLocal: { id: string; odooPartnerId: number } | null = null;
let marcasPrevias = 0;
const sesiones: string[] = [];
let ajeno = 0;

async function pedir<B>(metodo: string, ruta: string, quien: keyof typeof tokens, cuerpo?: unknown) {
  const res = await fetch(`${baseUrl}/api/v1${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokens[quien]}`, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (res.status === 204 ? null : await res.json()) as B };
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@impulsa.local' } } })) throw new Error('Restos de usuarios @impulsa.local: límpialos a mano.');
  comprobado = true;
  vaciarCachePasale();
  const ultimo = await prisma.apiRequestLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  idBitacoraInicial = ultimo?.id ?? 0n;

  // Un vendedor real con sugerencias. Su fila local ya existe (la sincronización
  // trae a todos) y `odoo_user_id` es único, así que no se crea otra: se usa la
  // suya con una sesión propia del test, y al final se borra solo lo creado.
  const locales = await prisma.appUser.findMany({
    where: { role: 'VENDEDOR', isActive: true, odooUserId: { not: null } },
    select: { id: true, odooUserId: true, odooPartnerId: true },
  });
  for (const u of locales) {
    const r = await sugerenciasPasale(u.odooUserId!, u.id);
    if (r.data.length > 0) {
      vendedorOdoo = u.odooUserId!;
      vendedorLocal = u;
      break;
    }
  }
  if (!vendedorLocal) throw new Error('Ningún vendedor local tiene sugerencias: el test no probaría nada.');
  marcasPrevias = await prisma.impulsaAccion.count({ where: { userId: vendedorLocal.id } });
  if (marcasPrevias) throw new Error('El vendedor elegido ya tiene marcas en la base local: el test no las toca.');

  const cartera = new Set(await idsDeCartera(vendedorOdoo));
  const [otro] = await searchRead<{ id: number }>('res.partner', [['customer_rank', '>', 0], ['parent_id', '=', false], ['user_id', '!=', vendedorOdoo], ['user_id', '!=', false]], ['id'], { limit: 1 });
  ajeno = otro!.id;
  if (cartera.has(ajeno)) throw new Error('el cliente ajeno es de la cartera');

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  baseUrl = `http://127.0.0.1:${dir.port}`;

  const crear = async (rol: 'SUPERADMIN', sufijo: string, partner: number, odooUserId: number | null) => {
    const u = await prisma.appUser.create({
      data: { email: `test.${sufijo}@impulsa.local`, fullName: `Impulsa ${sufijo}`, role: rol, odooPartnerId: partner, odooUserId, isActive: true },
    });
    usuarios.push(u.id);
    const s = await prisma.userSession.create({ data: { userId: u.id, refreshTokenHash: hashSecreto(`imp-${u.id}-${Math.random()}`), expiresAt: caducaEnDias(1) } });
    return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId, sid: s.id });
  };
  const sesion = await prisma.userSession.create({
    data: { userId: vendedorLocal.id, refreshTokenHash: hashSecreto(`imp-${vendedorLocal.id}-${Math.random()}`), expiresAt: caducaEnDias(1) },
  });
  sesiones.push(sesion.id);
  tokens.vendedor = await emitirAccessToken({ sub: vendedorLocal.id, role: 'VENDEDOR', odooPartnerId: vendedorLocal.odooPartnerId, odooUserId: vendedorOdoo, sid: sesion.id });
  tokens.admin = await crear('SUPERADMIN', 'admin', 3_920_000_002, null);
}, 180_000);

afterAll(async () => {
  if (comprobado) {
    if (vendedorLocal) await prisma.impulsaAccion.deleteMany({ where: { userId: vendedorLocal.id } });
    await prisma.userSession.deleteMany({ where: { id: { in: sesiones } } });
    await prisma.apiRequestLog.deleteMany({ where: { id: { gt: idBitacoraInicial } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  vaciarCachePasale();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('«Impulsa» por HTTP', () => {
  it('el vendedor ve sugerencias solo de su cartera', async () => {
    const r = await pedir<ImpulsaRespuesta>('GET', '/salesperson/impulsa', 'vendedor');
    expect(r.status).toBe(200);
    const cartera = new Set(await idsDeCartera(vendedorOdoo));
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.filter((c) => !cartera.has(c.partnerId)).map((c) => c.nombre)).toEqual([]);
  });

  it('un administrador no tiene «Impulsa»: no tiene cartera', async () => {
    expect((await pedir('GET', '/salesperson/impulsa', 'admin')).status).toBe(403);
  });

  it('marcar, posponer y deshacer, y que se vea al momento', async () => {
    const antes = await pedir<ImpulsaRespuesta>('GET', '/salesperson/impulsa', 'vendedor');
    const cliente = antes.body.data[0]!;
    const s = cliente.sugerencias[0]!;
    const ver = async () => (await pedir<ImpulsaRespuesta>('GET', '/salesperson/impulsa', 'vendedor')).body.data.find((c) => c.partnerId === cliente.partnerId)!.sugerencias.find((x) => x.clave === s.clave)!;

    expect((await pedir('POST', `/salesperson/clients/${cliente.partnerId}/impulsa`, 'vendedor', { tipo: 'pasale_a_asta', clave: s.clave, estado: 'HECHA' })).status).toBe(204);
    expect(await ver()).toMatchObject({ visible: false, marca: { estado: 'HECHA', hasta: null } });

    expect((await pedir('POST', `/salesperson/clients/${cliente.partnerId}/impulsa`, 'vendedor', { tipo: 'pasale_a_asta', clave: s.clave, estado: 'POSPUESTA', dias: 7 })).status).toBe(204);
    const pospuesta = await ver();
    expect(pospuesta.visible).toBe(false);
    expect(pospuesta.marca?.estado).toBe('POSPUESTA');
    expect(pospuesta.marca?.hasta).toBe(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));

    expect((await pedir('POST', `/salesperson/clients/${cliente.partnerId}/impulsa`, 'vendedor', { tipo: 'pasale_a_asta', clave: s.clave, estado: 'ACTIVA' })).status).toBe(204);
    expect(await ver()).toMatchObject({ visible: true, marca: null });
    // Una fila, reescrita: sin DELETE (#44), «deshacer» no borra.
    expect(await prisma.impulsaAccion.count({ where: { userId: vendedorLocal!.id } })).toBe(1);
  });

  it('no se marca un cliente de otro vendedor', async () => {
    const r = await pedir<{ error: { code: string } }>('POST', `/salesperson/clients/${ajeno}/impulsa`, 'vendedor', { tipo: 'pasale_a_asta', clave: '1', estado: 'HECHA' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('PARTNER_NOT_IN_PORTFOLIO');
  });

  it('una sugerencia que no existe es 404, y un cuerpo mal formado, 400', async () => {
    const r = await pedir<ImpulsaRespuesta>('GET', '/salesperson/impulsa', 'vendedor');
    const cliente = r.body.data[0]!.partnerId;
    expect((await pedir('POST', `/salesperson/clients/${cliente}/impulsa`, 'vendedor', { tipo: 'pasale_a_asta', clave: '999999999', estado: 'HECHA' })).status).toBe(404);
    expect((await pedir('POST', `/salesperson/clients/${cliente}/impulsa`, 'vendedor', { tipo: 'pasale_a_asta', clave: 'x', estado: 'HECHA' })).status).toBe(400);
    expect((await pedir('POST', `/salesperson/clients/${cliente}/impulsa`, 'vendedor', { tipo: 'otro', clave: '1', estado: 'HECHA' })).status).toBe(400);
  });
});
