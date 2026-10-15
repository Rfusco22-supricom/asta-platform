import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { AccesoImposible, darAccesoPersonal, listarConAcceso, quitarAccesoPersonal, type UsuarioOdoo } from '../services/accesoPersonal.service.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';

/**
 * #81 · Acceso al panel para el personal que no es vendedor.
 *
 * Odoo de mentira (se inyecta la búsqueda) y cuentas «@acceso-personal.local»,
 * que se borran al final. Lo que se vigila:
 *
 *   · crea la cuenta atada al usuario de Odoo, con el rol pedido;
 *   · el simulacro no escribe;
 *   · si ya existe (un vendedor, una cuenta desactivada), la promociona sin duplicarla;
 *   · no da acceso a un usuario archivado, del portal o ambiguo;
 *   · repetir no cambia nada.
 */

const DOMINIO = '@acceso-personal.local';
const UID = 3_860_000_001;
const PARTNER = 3_860_000_101;
const odoo = (extra: Partial<UsuarioOdoo> = {}): UsuarioOdoo => ({
  id: UID,
  name: 'ZZ Gerente Prueba',
  login: `gerente${DOMINIO}`,
  active: true,
  share: false,
  partner_id: [PARTNER, 'ZZ Gerente Prueba'],
  ...extra,
});
const buscar = (usuarios: UsuarioOdoo[]) => async () => usuarios;
const cuenta = () => prisma.appUser.findFirst({ where: { email: { endsWith: DOMINIO } } });

let comprobado = false;
beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: DOMINIO } } })) throw new Error(`Restos de ${DOMINIO}: límpialos a mano.`);
  comprobado = true;
});
beforeEach(async () => {
  if (comprobado) await prisma.appUser.deleteMany({ where: { email: { endsWith: DOMINIO } } });
});
afterAll(async () => {
  if (comprobado) await prisma.appUser.deleteMany({ where: { email: { endsWith: DOMINIO } } });
  await prisma.$disconnect();
});

describe('#81 · Acceso del personal', () => {
  it('crea la cuenta atada a Odoo con el rol pedido; el simulacro no escribe', async () => {
    const simulado = await darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'SUPERADMIN', aplicar: false }, buscar([odoo()]));
    expect(simulado).toEqual({ tipo: 'crear', email: `gerente${DOMINIO}`, nombre: 'ZZ Gerente Prueba', rol: 'SUPERADMIN', odooUserId: UID });
    expect(await cuenta()).toBeNull();

    await darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'SUPERADMIN', aplicar: true }, buscar([odoo()]));
    expect(await cuenta()).toMatchObject({ role: 'SUPERADMIN', odooUserId: UID, odooPartnerId: PARTNER, isActive: true });

    expect((await darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'SUPERADMIN', aplicar: true }, buscar([odoo()]))).tipo).toBe('igual');
  });

  it('una cuenta que ya existía se promociona, no se duplica', async () => {
    await prisma.appUser.create({ data: { email: `gerente${DOMINIO}`, fullName: 'ZZ Gerente Prueba', role: 'VENDEDOR', odooPartnerId: PARTNER, isActive: false } });
    const r = await darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'SUPERADMIN', aplicar: true }, buscar([odoo()]));
    expect(r).toMatchObject({ tipo: 'cambiar', rolAnterior: 'VENDEDOR', rol: 'SUPERADMIN' });
    expect(await prisma.appUser.count({ where: { email: { endsWith: DOMINIO } } })).toBe(1);
    expect(await cuenta()).toMatchObject({ role: 'SUPERADMIN', odooUserId: UID, isActive: true });
  });

  it('no da acceso a un usuario archivado, del portal, sin contacto o ambiguo', async () => {
    const intentar = (usuarios: UsuarioOdoo[]) => darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'SUPERADMIN', aplicar: true }, buscar(usuarios));
    await expect(intentar([])).rejects.toThrow(AccesoImposible);
    await expect(intentar([odoo({ active: false })])).rejects.toThrow(/archivado/);
    await expect(intentar([odoo({ share: true })])).rejects.toThrow(/portal/);
    await expect(intentar([odoo({ partner_id: false })])).rejects.toThrow(/contacto/);
    await expect(intentar([odoo(), odoo({ id: UID + 1 })])).rejects.toThrow(/más de un usuario/);
    expect(await cuenta()).toBeNull();
  });
});

describe('#81 · Quitar el acceso desde el panel', () => {
  const dar = () => darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'VENDEDOR', aplicar: true }, buscar([odoo()]));

  it('desactiva la cuenta, cierra sus sesiones y deja de salir en la lista; devolverlo la reactiva', async () => {
    await dar();
    const c = (await cuenta())!;
    await prisma.userSession.create({ data: { userId: c.id, refreshTokenHash: hashSecreto(`acc-${Date.now()}`), expiresAt: caducaEnDias(1) } });
    expect((await listarConAcceso()).some((p) => p.appUserId === c.id)).toBe(true);

    const r = await quitarAccesoPersonal(UID, 'otro-admin');
    expect(r.sesionesCerradas).toBe(1);
    expect(await cuenta()).toMatchObject({ isActive: false });
    expect(await prisma.userSession.count({ where: { userId: c.id, revokedAt: null } })).toBe(0);
    expect((await listarConAcceso()).some((p) => p.appUserId === c.id)).toBe(false);

    await expect(quitarAccesoPersonal(UID, 'otro-admin')).rejects.toThrow(/no tiene acceso/);
    expect((await dar()).tipo).toBe('cambiar');
    expect(await cuenta()).toMatchObject({ isActive: true, role: 'VENDEDOR' });
    await prisma.userSession.deleteMany({ where: { userId: c.id } });
  });

  it('nadie se quita el acceso ni se cambia el rol a sí mismo', async () => {
    await dar();
    const yo = (await cuenta())!.id;
    await expect(quitarAccesoPersonal(UID, yo)).rejects.toThrow(/a ti mismo/);
    await expect(darAccesoPersonal({ login: `gerente${DOMINIO}`, rol: 'SUPERADMIN', aplicar: true, actorId: yo }, buscar([odoo()]))).rejects.toThrow(/tu propio rol/);
    expect(await cuenta()).toMatchObject({ isActive: true, role: 'VENDEDOR' });
  });
});
