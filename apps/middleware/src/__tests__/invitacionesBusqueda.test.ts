import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';

/**
 * #16 · Encontrar al cliente que pide acceso, para invitarlo.
 *
 * Los clientes se invitan cuando lo piden, no en bloque. Sin búsqueda, la
 * pantalla enseñaba los 25 primeros por orden alfabético de más de 2.000, y a
 * quien pedía acceso no había forma de encontrarlo.
 *
 * Cuentas inventadas `@invitar16.local` con nombres «ZZ Invitar16 …», que no
 * usa nadie más. MySQL real.
 */

process.env.JWT_SECRET = 'clave-de-pruebas-con-mas-de-treinta-y-dos-caracteres';
process.env.ARGON2_MEMORY_KIB = '8192';
process.env.ARGON2_ITERATIONS = '1';

const { resetAuthEnvCache } = await import('../config/authEnv.js');
const { prisma } = await import('../config/prisma.js');
const { listarSinAcceso } = await import('../services/invitation.service.js');

const DOMINIO = 'invitar16.local';
const PARTNER = { ferreteria: 3_995_160_001, papeleria: 3_995_160_002, conClave: 3_995_160_003, inactiva: 3_995_160_004 };
let comprobado = false;

const limpiar = async () => {
  const ids = (await prisma.appUser.findMany({ where: { email: { endsWith: `@${DOMINIO}` } }, select: { id: true } })).map((u) => u.id);
  await prisma.userCredential.deleteMany({ where: { userId: { in: ids } } });
  await prisma.appUser.deleteMany({ where: { id: { in: ids } } });
};

beforeAll(async () => {
  resetAuthEnvCache();
  if (await prisma.appUser.count({ where: { email: { endsWith: `@${DOMINIO}` } } })) throw new Error(`Restos @${DOMINIO}: límpialos a mano.`);
  comprobado = true;

  const crear = (local: string, nombre: string, odooPartnerId: number, isActive = true) =>
    prisma.appUser.create({ data: { email: `${local}@${DOMINIO}`, fullName: nombre, role: 'BRONCE', odooPartnerId, isActive } });

  await crear('ferreteria', 'ZZ Invitar16 Ferretería Pérez, C.A.', PARTNER.ferreteria);
  await crear('papeleria', 'ZZ Invitar16 Papelería Central', PARTNER.papeleria);
  const conClave = await crear('conclave', 'ZZ Invitar16 Ya Entra', PARTNER.conClave);
  await prisma.userCredential.create({ data: { userId: conClave.id, passwordHash: 'no-importa-aqui' } });
  await crear('inactiva', 'ZZ Invitar16 De Baja', PARTNER.inactiva, false);
}, 60_000);

afterAll(async () => {
  if (comprobado) await limpiar();
  await prisma.$disconnect();
});

const nombres = (r: Awaited<ReturnType<typeof listarSinAcceso>>) => r.usuarios.map((u) => u.nombre).sort();

describe('#16 · Buscar a quién invitar', () => {
  it('por un trozo del nombre, sin importar mayúsculas ni el resto del listado', async () => {
    const r = await listarSinAcceso(25, 'invitar16 ferre');
    expect(nombres(r)).toEqual(['ZZ Invitar16 Ferretería Pérez, C.A.']);
    expect(r.coincidencias).toBe(1);
  });

  it('por el correo, aunque se escriba en mayúsculas: se guarda en minúsculas', async () => {
    const r = await listarSinAcceso(25, `PAPELERIA@${DOMINIO.toUpperCase()}`);
    expect(nombres(r)).toEqual(['ZZ Invitar16 Papelería Central']);
  });

  it('por el número de cliente de Odoo, exacto', async () => {
    const r = await listarSinAcceso(25, String(PARTNER.papeleria));
    expect(nombres(r)).toEqual(['ZZ Invitar16 Papelería Central']);
  });

  it('solo cuentas sin acceso: ni las que ya entran ni las desactivadas', async () => {
    const r = await listarSinAcceso(25, 'ZZ Invitar16');
    expect(nombres(r)).toEqual(['ZZ Invitar16 Ferretería Pérez, C.A.', 'ZZ Invitar16 Papelería Central']);
  });

  it('el total sigue siendo el de todas las cuentas sin acceso, no el de la búsqueda', async () => {
    const sinBuscar = await listarSinAcceso(1);
    const buscando = await listarSinAcceso(25, 'invitar16 ferre');
    expect(buscando.total).toBe(sinBuscar.total);
    expect(buscando.total).toBeGreaterThanOrEqual(2);
    expect(sinBuscar.coincidencias).toBe(sinBuscar.total);
  });

  it('una búsqueda sin resultados devuelve vacío, no el listado entero', async () => {
    const r = await listarSinAcceso(25, 'zz-no-existe-ningun-cliente-asi');
    expect(r.usuarios).toEqual([]);
    expect(r.coincidencias).toBe(0);
  });
});
