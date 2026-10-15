import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { AccesoImposible, darAccesoPersonal, type UsuarioOdoo } from '../services/accesoPersonal.service.js';

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
