import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { resetAuthEnvCache } from '../config/authEnv.js';
import { hashPassword } from '../auth/password.js';
import { login } from '../services/auth.service.js';

/**
 * El primer acceso al panel (`app_users.primer_acceso_at`): con él empieza el
 * Programa ASTA del cliente. Se escribe en el primer login y no vuelve a
 * cambiar; el último acceso sí cambia en cada uno.
 *
 * Contra MySQL, con una cuenta de cliente inventada («@primer-acceso.local»)
 * que se borra al final.
 */

const EMAIL = 'test.cliente@primer-acceso.local';
const CLAVE = 'una frase de prueba bastante larga';

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'clave-de-pruebas-con-mas-de-treinta-y-dos-caracteres';
  process.env.ARGON2_MEMORY_KIB = '8192';
  process.env.ARGON2_ITERATIONS = '1';
  resetAuthEnvCache();
  if (await prisma.appUser.count({ where: { email: { endsWith: '@primer-acceso.local' } } })) throw new Error('Restos de @primer-acceso.local: límpialos a mano.');
  await prisma.appUser.create({
    data: {
      email: EMAIL,
      fullName: 'Cliente de prueba',
      role: 'GENERAL',
      odooPartnerId: 3_960_000_001,
      isActive: true,
      isCustomer: true,
      credentials: { create: { passwordHash: await hashPassword(CLAVE) } },
    },
  });
});

afterAll(async () => {
  await prisma.appUser.deleteMany({ where: { email: { endsWith: '@primer-acceso.local' } } });
  await prisma.$disconnect();
});

const cuenta = () => prisma.appUser.findUniqueOrThrow({ where: { email: EMAIL }, select: { primerAccesoAt: true, lastLoginAt: true } });

describe('Primer acceso al panel', () => {
  it('antes de entrar no hay primer acceso: el cliente no está en el programa', async () => {
    expect((await cuenta()).primerAccesoAt).toBeNull();
  });

  it('el primer login lo guarda, y los siguientes no lo cambian', async () => {
    await login(EMAIL, CLAVE);
    const primero = await cuenta();
    expect(primero.primerAccesoAt).not.toBeNull();
    expect(primero.primerAccesoAt).toEqual(primero.lastLoginAt);

    await new Promise((r) => setTimeout(r, 20));
    await login(EMAIL, CLAVE);
    const segundo = await cuenta();
    expect(segundo.primerAccesoAt).toEqual(primero.primerAccesoAt);
    expect(segundo.lastLoginAt!.getTime()).toBeGreaterThan(primero.lastLoginAt!.getTime());
  });
});
