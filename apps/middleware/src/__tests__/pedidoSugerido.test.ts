import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { MAX_PEDIDOS_ABIERTOS, pedidoClienteRespuestaSchema, pedidoSugeridoRespuestaSchema, pedidosClienteRespuestaSchema } from '@asta/shared-types';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';
import { catalogoAsta } from '../services/sellOut.service.js';
import { sugerir } from '../services/pedidoSugerido.service.js';
import { esperarBitacora } from './soportes/esperarBitacora.js';

/**
 * El pedido sugerido de reposición.
 *
 *   · con sell-out, lo que falta para `DIAS_COBERTURA` días de venta; sin él,
 *     lo que suele comprar al mes menos lo de este mes
 *   · el cliente lo envía; como mucho `MAX_PEDIDOS_ABIERTOS` sin atender
 *   · el vendedor solo ve y marca los de sus clientes; administración, todos
 *   · un pedido se atiende una vez
 *
 * Partner inventado (3_860_000_001): en Odoo no existe, así que no tiene
 * compras, ni vendedor, ni tarifa. El pedido se envía igual, sin precios, y
 * solo lo ve administración.
 */

let server: Server;
let base = '';
const usuarios: string[] = [];
const tokens = { cliente: '', vendedor: '', admin: '' };
const PARTNER = 3_860_000_001;
const INICIO = new Date();
const AGENTE = 'asta-test-pedido-sugerido';
let producto: number;

async function pedir<B>(metodo: 'GET' | 'POST' | 'PATCH', ruta: string, quien: keyof typeof tokens, cuerpo?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'User-Agent': AGENTE, Authorization: `Bearer ${tokens[quien]}`, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: (await res.json()) as B };
}

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE', sufijo: string, partner: number, odooUserId: number | null) {
  const u = await prisma.appUser.create({
    data: { email: `test.pedido.${sufijo}@pedido.local`, fullName: `Pedido ${sufijo}`, role: rol, odooPartnerId: partner, odooUserId, isActive: true },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`ps-${sufijo}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: partner, odooUserId, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@pedido.local' } } })) throw new Error('Restos de @pedido.local: límpialos a mano.');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;
  tokens.cliente = await usuarioConToken('BRONCE', 'cliente', PARTNER, null);
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor', 3_860_000_002, 3_860_000);
  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin', 3_860_000_003, null);
  const { porId } = await catalogoAsta();
  const uno = [...porId.values()][0];
  if (!uno) throw new Error('El catálogo ASTA de Odoo viene vacío');
  producto = uno.id;
}, 120_000);

afterAll(async () => {
  await esperarBitacora(INICIO);
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { gte: INICIO }, userAgent: AGENTE } });
  await prisma.pedidoCliente.deleteMany({ where: { odooPartnerId: PARTNER } });
  if (usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

describe('La sugerencia', () => {
  const r = { productId: 1, sku: 'A-1', nombre: 'Tóner', compraMensual: 0, compradoMes: 0 };

  it('con sell-out: lo que falta para 45 días de venta, y para cuántos días le queda', () => {
    // Vende 30 al mes (1 al día) y le quedan 10: le faltan 35 para 45 días.
    expect(sugerir({ ...r, ventaMensual: 30, quedan: 10 })).toMatchObject({ origen: 'SELLOUT', sugeridas: 35, diasQueQuedan: 10 });
    // 2,5 al día: 112,5 para 45 días, menos 100 → 13 (se redondea hacia arriba).
    expect(sugerir({ ...r, ventaMensual: 75, quedan: 100 })).toMatchObject({ sugeridas: 13, diasQueQuedan: 40 });
  });

  it('con sell-out, nada si no lo vende o si le alcanza', () => {
    expect(sugerir({ ...r, ventaMensual: 0, quedan: 0, compraMensual: 20 })).toBeNull();
    expect(sugerir({ ...r, ventaMensual: 30, quedan: 45 })).toBeNull();
  });

  it('sin sell-out: lo que suele comprar al mes menos lo que ya compró este', () => {
    expect(sugerir({ ...r, ventaMensual: null, quedan: null, compraMensual: 12.4, compradoMes: 5 })).toMatchObject({ origen: 'COMPRAS', sugeridas: 8, diasQueQuedan: null });
    expect(sugerir({ ...r, ventaMensual: null, quedan: null, compraMensual: 6, compradoMes: 6 })).toBeNull();
  });
});

describe('Enviarlo y atenderlo', () => {
  it('sin compras ni sell-out, no se sugiere nada', async () => {
    const r = await pedir<unknown>('GET', '/api/v1/account/pedido-sugerido', 'cliente');
    expect(r.status).toBe(200);
    expect(pedidoSugeridoRespuestaSchema.parse(r.body).data).toEqual({ conSellOut: false, lineas: [] });
  }, 60_000);

  it('el personal no tiene pedido sugerido', async () => {
    expect((await pedir('GET', '/api/v1/account/pedido-sugerido', 'vendedor')).status).toBe(403);
  });

  it('un producto que no es de ASTA, o repetido, no se envía', async () => {
    expect((await pedir('POST', '/api/v1/account/pedidos', 'cliente', { lineas: [{ productId: 999_999_999, cantidad: 1 }] })).status).toBe(400);
    const repetido = { lineas: [{ productId: producto, cantidad: 1 }, { productId: producto, cantidad: 2 }] };
    expect((await pedir('POST', '/api/v1/account/pedidos', 'cliente', repetido)).status).toBe(400);
    expect(await prisma.pedidoCliente.count({ where: { odooPartnerId: PARTNER } })).toBe(0);
  }, 60_000);

  it(`se envía; como mucho ${MAX_PEDIDOS_ABIERTOS} sin atender`, async () => {
    for (let i = 0; i < MAX_PEDIDOS_ABIERTOS; i++) {
      const r = await pedir<unknown>('POST', '/api/v1/account/pedidos', 'cliente', { lineas: [{ productId: producto, cantidad: 4 + i }], nota: 'Para el viernes' });
      expect(r.status).toBe(201);
      const p = pedidoClienteRespuestaSchema.parse(r.body).data;
      // Sin tarifa ni vendedor en Odoo: sin precio, y solo para administración.
      expect(p).toMatchObject({ estado: 'ENVIADO', unidades: 4 + i, importeEstimado: null, nota: 'Para el viernes' });
    }
    const otro = await pedir<{ error: { message: string } }>('POST', '/api/v1/account/pedidos', 'cliente', { lineas: [{ productId: producto, cantidad: 1 }] });
    expect(otro.status).toBe(400);
    expect(otro.body.error.message).toMatch(/sin atender/);
  }, 120_000);

  it('el vendedor no ve ni marca los de clientes que no son suyos', async () => {
    const lista = await pedir<unknown>('GET', '/api/v1/salesperson/pedidos-clientes', 'vendedor');
    expect(pedidosClienteRespuestaSchema.parse(lista.body).data.filter((p) => p.partnerId === PARTNER)).toEqual([]);
    const uno = await prisma.pedidoCliente.findFirstOrThrow({ where: { odooPartnerId: PARTNER } });
    expect((await pedir('PATCH', `/api/v1/salesperson/pedidos-clientes/${uno.id}`, 'vendedor', { estado: 'EN_ODOO' })).status).toBe(403);
  });

  it('administración los ve y los marca, una vez', async () => {
    const lista = await pedir<unknown>('GET', '/api/v1/admin/pedidos-clientes', 'admin');
    const mios = pedidosClienteRespuestaSchema.parse(lista.body).data.filter((p) => p.partnerId === PARTNER);
    expect(mios).toHaveLength(MAX_PEDIDOS_ABIERTOS);
    const [primero, segundo] = mios;

    const enOdoo = await pedir<unknown>('PATCH', `/api/v1/admin/pedidos-clientes/${primero!.id}`, 'admin', { estado: 'EN_ODOO', folioOdoo: 'S-00001' });
    expect(pedidoClienteRespuestaSchema.parse(enOdoo.body).data).toMatchObject({ estado: 'EN_ODOO', folioOdoo: 'S-00001' });
    expect((await pedir('PATCH', `/api/v1/admin/pedidos-clientes/${primero!.id}`, 'admin', { estado: 'DESCARTADO', motivo: 'x' })).status).toBe(400);

    // Descartar pide el motivo.
    expect((await pedir('PATCH', `/api/v1/admin/pedidos-clientes/${segundo!.id}`, 'admin', { estado: 'DESCARTADO' })).status).toBe(400);
    expect((await pedir('PATCH', `/api/v1/admin/pedidos-clientes/${segundo!.id}`, 'admin', { estado: 'DESCARTADO', motivo: 'Duplicado' })).status).toBe(200);
  });

  it('el cliente ve en qué quedaron los suyos', async () => {
    const r = await pedir<unknown>('GET', '/api/v1/account/pedidos', 'cliente');
    const estados = pedidosClienteRespuestaSchema.parse(r.body).data.map((p) => p.estado).sort();
    expect(estados).toEqual(['DESCARTADO', 'ENVIADO', 'EN_ODOO']);
  });
});
