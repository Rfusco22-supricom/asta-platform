import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';

/**
 * El correo de acceso de un cliente, fijado en el panel cuando no puede usar el
 * de Odoo (`correoAcceso.service`).
 *
 * Cuentas inventadas `@correoacceso.local` con partners que no existen en Odoo
 * (3_995_170_xxx). MySQL real.
 */

const { prisma } = await import('../config/prisma.js');
const { CorreoNoValido, cambiarCorreoAcceso } = await import('../services/correoAcceso.service.js');
const { listarSinAcceso } = await import('../services/invitation.service.js');
const { resincronizarUno } = await import('../services/reconciliation.service.js');
const { searchRead } = await import('../odoo/client.js');

const DOMINIO = 'correoacceso.local';
const PARTNER = { cliente: 3_995_170_001, otro: 3_995_170_002, vendedor: 3_995_170_003 };
let comprobado = false;
const ids: Record<keyof typeof PARTNER, string> = { cliente: '', otro: '', vendedor: '' };

const limpiar = async () => {
  const filas = await prisma.appUser.findMany({ where: { OR: [{ odooPartnerId: { in: Object.values(PARTNER) } }, { email: { endsWith: `@${DOMINIO}` } }] }, select: { id: true } });
  const us = filas.map((u) => u.id);
  await prisma.authToken.deleteMany({ where: { userId: { in: us } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: us }, action: 'user.correo_acceso' } });
  await prisma.appUser.deleteMany({ where: { id: { in: us } } });
};

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { odooPartnerId: { in: Object.values(PARTNER) } } })) throw new Error(`Restos de ${DOMINIO}: límpialos a mano.`);
  comprobado = true;
  const crear = async (k: keyof typeof PARTNER, role: 'BRONCE' | 'VENDEDOR') =>
    (ids[k] = (await prisma.appUser.create({ data: { email: `${k}@${DOMINIO}`, fullName: `ZZ CorreoAcceso ${k}`, role, odooPartnerId: PARTNER[k] } })).id);
  await crear('cliente', 'BRONCE');
  await crear('otro', 'BRONCE');
  await crear('vendedor', 'VENDEDOR');
  await prisma.authToken.create({ data: { userId: ids.cliente, purpose: 'INVITE', tokenHash: 'zz-correoacceso-hash', expiresAt: new Date(Date.now() + 86_400_000) } });
}, 60_000);

afterAll(async () => {
  if (comprobado) await limpiar();
  await prisma.$disconnect();
});

describe('Correo de acceso fijado en el panel', () => {
  it('lo cambia, lo marca como fijado y anula la invitación que iba al correo anterior', async () => {
    const r = await cambiarCorreoAcceso(ids.cliente, '  Nuevo.Cliente@' + DOMINIO.toUpperCase() + ' ', null);
    expect(r).toEqual({ email: `nuevo.cliente@${DOMINIO}`, emailFijado: true });
    const u = await prisma.appUser.findUniqueOrThrow({ where: { id: ids.cliente }, select: { email: true, emailFijado: true } });
    expect(u).toEqual({ email: `nuevo.cliente@${DOMINIO}`, emailFijado: true });
    expect(await prisma.authToken.count({ where: { userId: ids.cliente, usedAt: null } })).toBe(0);
    const fila = (await listarSinAcceso(25, 'ZZ CorreoAcceso cliente')).usuarios.find((x) => x.id === ids.cliente);
    expect(fila).toMatchObject({ email: `nuevo.cliente@${DOMINIO}`, emailFijado: true });
  });

  it('no deja un correo que ya usa otra cuenta, ni uno sin forma de correo', async () => {
    await expect(cambiarCorreoAcceso(ids.cliente, `otro@${DOMINIO}`, null)).rejects.toBeInstanceOf(CorreoNoValido);
    await expect(cambiarCorreoAcceso(ids.cliente, 'no-es-un-correo', null)).rejects.toBeInstanceOf(CorreoNoValido);
  });

  it('el personal no: entra con su usuario de Odoo', async () => {
    await expect(cambiarCorreoAcceso(ids.vendedor, `vendedor2@${DOMINIO}`, null)).rejects.toBeInstanceOf(CorreoNoValido);
  });

  it('si no se puede volver al de Odoo, el correo fijado se queda como estaba', async () => {
    // El partner no existe en Odoo: no hay correo al que volver.
    await expect(cambiarCorreoAcceso(ids.cliente, null, null)).rejects.toBeInstanceOf(CorreoNoValido);
    const u = await prisma.appUser.findUniqueOrThrow({ where: { id: ids.cliente }, select: { email: true, emailFijado: true } });
    expect(u).toEqual({ email: `nuevo.cliente@${DOMINIO}`, emailFijado: true });
  });

  it('la sincronización con Odoo respeta el correo fijado', async () => {
    // Un partner real de Odoo con correo y sin cuenta en esta base: se le crea
    // una cuenta de prueba con el correo fijado y se resincroniza.
    const candidatos = await searchRead<{ id: number; email: string | false }>('res.partner', [['email', '!=', false], ['email', 'ilike', '@']], ['id', 'email'], { limit: 50, order: 'id desc' });
    const conCuenta = new Set((await prisma.appUser.findMany({ where: { odooPartnerId: { in: candidatos.map((c) => c.id) } }, select: { odooPartnerId: true } })).map((u) => u.odooPartnerId));
    const libre = candidatos.find((c) => !conCuenta.has(c.id));
    if (!libre) throw new Error('No hay un partner con correo y sin cuenta para probar.');
    await prisma.appUser.create({ data: { email: `fijado@${DOMINIO}`, emailFijado: true, fullName: 'ZZ CorreoAcceso fijado', role: 'BRONCE', odooPartnerId: libre.id } });
    try {
      const r = await resincronizarUno(libre.id);
      expect(r.ok, r.mensaje).toBe(true);
      const u = await prisma.appUser.findUniqueOrThrow({ where: { odooPartnerId: libre.id }, select: { email: true, emailFijado: true, fullName: true } });
      expect(u.email).toBe(`fijado@${DOMINIO}`);
      expect(u.emailFijado).toBe(true);
      // El resto sí viene de Odoo.
      expect(u.fullName).not.toBe('ZZ CorreoAcceso fijado');
    } finally {
      await prisma.appUser.deleteMany({ where: { odooPartnerId: libre.id, email: `fijado@${DOMINIO}` } });
    }
  }, 60_000);
});
