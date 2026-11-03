import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { facturasClienteRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { searchRead } from '../odoo/client.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * «Mis facturas» del cliente en el panel.
 *
 *   · el cliente ve lo suyo: un partner sin facturas no ve ninguna, ni deuda
 *   · el PDF de una factura de otro responde lo mismo que una que no existe
 *   · el personal no tiene «Mis facturas»
 *
 * Partner inventado (2_000_000_001): cabe en el entero de Odoo y no existe.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { cliente: '', vendedor: '' };
const PARTNER = 2_000_000_001;
const INICIO = new Date();
const AGENTE = 'asta-test-mis-facturas';
let ajena: number;

async function usuarioConToken(rol: 'BRONCE' | 'VENDEDOR', sufijo: string, partner: number) {
  const u = await prisma.appUser.create({ data: { email: `test.facturas.${sufijo}@facturas.local`, fullName: `Facturas ${sufijo}`, role: rol, odooPartnerId: partner, isActive: true } });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`fc-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId: null, sid: sesion.id });
}

const pedir = (ruta: string, quien: keyof typeof tokens) => fetch(`${base}${ruta}`, { headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}` } });

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@facturas.local' } } })) throw new Error('Restos de @facturas.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente', PARTNER);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 2_000_000_002);
  // Una factura de verdad, de otro cliente.
  const [f] = await searchRead<{ id: number }>('account.move', [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], ['id'], { limit: 1 });
  if (!f) throw new Error('Odoo no trae ninguna factura');
  ajena = f.id;
}, 60_000);

afterAll(async () => {
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  if (usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('Mis facturas', () => {
  it('un cliente sin facturas no ve ninguna, ni deuda', async () => {
    for (const vista of ['pendientes', 'todas']) {
      const res = await pedir(`/api/v1/account/facturas?vista=${vista}`, 'cliente');
      expect(res.status).toBe(200);
      const d = facturasClienteRespuestaSchema.parse(await res.json()).data;
      expect(d).toMatchObject({ vista, facturas: [], total: 0, pagina: 1 });
      expect(d.resumen).toEqual({ porPagar: 0, facturasPorPagar: 0, vencido: 0, facturasVencidas: 0, vencePronto: 0, facturasVencenPronto: 0, proximoVencimiento: null });
    }
  }, 60_000);

  it('una vista o una página que no existen: 400', async () => {
    expect((await pedir('/api/v1/account/facturas?vista=otra', 'cliente')).status).toBe(400);
    expect((await pedir('/api/v1/account/facturas?pagina=0', 'cliente')).status).toBe(400);
  });

  it('el PDF de una factura de otro cliente: el mismo 404 que una que no existe', async () => {
    const deOtro = await pedir(`/api/v1/account/facturas/${ajena}/pdf`, 'cliente');
    const inventada = await pedir('/api/v1/account/facturas/999999999/pdf', 'cliente');
    expect([deOtro.status, inventada.status]).toEqual([404, 404]);
    expect(await deOtro.json()).toEqual(await inventada.json());
  }, 60_000);

  it('el personal no tiene «Mis facturas»', async () => {
    expect((await pedir('/api/v1/account/facturas', 'vendedor')).status).toBe(403);
  });
});
