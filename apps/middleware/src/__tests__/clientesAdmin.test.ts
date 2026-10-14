import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';

/**
 * `GET /api/v1/admin/clientes`: la lista de clientes para la paleta ⌘K del
 * administrador.
 *
 * Lo que se vigila:
 *
 *   · solo el administrador la lee: ni un vendedor ni un cliente
 *   · trae cuentas de cliente activas, nunca personal ni cuentas desactivadas
 *
 * Datos: cuentas «@clientes-admin.local», que se borran al final.
 */

let server: Server;
let base = '';
const DOMINIO = '@clientes-admin.local';
const tokens = { admin: '', vendedor: '', cliente: '' };
let partner = 3_830_000_000;

async function cuenta(clave: string, rol: 'SUPERADMIN' | 'VENDEDOR' | 'GOLD' | 'BRONCE', activa = true) {
  return prisma.appUser.create({
    data: { email: `test.${clave}${DOMINIO}`, fullName: `ZZ Prueba ${clave}`, role: rol, odooPartnerId: partner++, isActive: activa },
  });
}

async function tokenDe(clave: string, rol: 'SUPERADMIN' | 'VENDEDOR' | 'GOLD') {
  const u = await cuenta(clave, rol);
  const sesion = await prisma.userSession.create({
    data: { userId: u.id, refreshTokenHash: hashSecreto(`cli-${clave}-${Date.now()}-${Math.random()}`), expiresAt: caducaEnDias(1) },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

const pedir = async (quien: keyof typeof tokens) => {
  const res = await fetch(`${base}/api/v1/admin/clientes`, { headers: { Authorization: `Bearer ${tokens[quien]}` } });
  return { status: res.status, body: (await res.json().catch(() => null)) as { data: Array<{ id: number; nombre: string; nivel: string }> } | null };
};

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: DOMINIO } } })) throw new Error(`Restos de ${DOMINIO}: límpialos a mano.`);
  tokens.admin = await tokenDe('admin', 'SUPERADMIN');
  tokens.vendedor = await tokenDe('vendedor', 'VENDEDOR');
  tokens.cliente = await tokenDe('cliente', 'GOLD');
  await cuenta('activa', 'BRONCE');
  await cuenta('inactiva', 'BRONCE', false);

  server = createApp().listen(0);
  const dir = server.address();
  base = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`;
});

afterAll(async () => {
  server?.close();
  await prisma.appUser.deleteMany({ where: { email: { endsWith: DOMINIO } } });
  await prisma.$disconnect();
});

describe('GET /api/v1/admin/clientes', () => {
  it('solo el administrador', async () => {
    expect((await pedir('vendedor')).status).toBe(403);
    expect((await pedir('cliente')).status).toBe(403);
    expect((await pedir('admin')).status).toBe(200);
  });

  it('cuentas de cliente activas, sin personal ni desactivadas', async () => {
    const { body } = await pedir('admin');
    const nuestros = body!.data.filter((c) => c.nombre.startsWith('ZZ Prueba '));
    const nombres = nuestros.map((c) => c.nombre).sort();
    // El cliente GOLD con sesión y la cuenta BRONCE activa; ni el admin, ni el vendedor, ni la desactivada.
    expect(nombres).toEqual(['ZZ Prueba activa', 'ZZ Prueba cliente']);
    expect(nuestros.find((c) => c.nombre === 'ZZ Prueba cliente')?.nivel).toBe('GOLD');
  });
});
