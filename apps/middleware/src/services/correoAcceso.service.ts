import { prisma } from '../config/prisma.js';
import { esEmailPlausible, normalizarEmail } from '../auth/email.js';
import { recordAudit } from './audit.service.js';
import { resincronizarUno } from './reconciliation.service.js';

/**
 * El correo con el que entra un CLIENTE al panel, cuando no puede usar el de su
 * ficha de Odoo y Odoo no se puede cambiar (por ejemplo, porque a ese correo le
 * llegan las facturas).
 *
 * El correo de una cuenta sale de Odoo y el sync lo copia cada pocos minutos.
 * Al fijarlo aquí, la cuenta queda con `emailFijado` y el sync deja de tocarlo
 * (`sync.service`, `resincronizarUno`). Odoo no se toca.
 *
 * Quitarlo (`null`) devuelve la cuenta al correo de Odoo en ese mismo momento.
 *
 * Al cambiarlo se anulan los enlaces de invitación y de contraseña sin usar:
 * iban al correo anterior. La contraseña y las sesiones no cambian.
 *
 * Solo clientes: el personal entra con su usuario de Odoo.
 */

export class CorreoNoValido extends Error {}

export async function cambiarCorreoAcceso(
  userId: string,
  correo: string | null,
  actorId: string | null,
  ip?: string,
): Promise<{ email: string; emailFijado: boolean }> {
  const usuario = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, odooPartnerId: true },
  });
  if (!usuario) throw new CorreoNoValido('Ese usuario no existe.');
  if (usuario.role === 'SUPERADMIN' || usuario.role === 'VENDEDOR') {
    throw new CorreoNoValido('El personal entra con su usuario de Odoo: su correo no se cambia aquí.');
  }

  let final: { email: string; emailFijado: boolean };
  if (correo === null) {
    // Vuelve al de Odoo: se quita la marca y se resincroniza ya, sin esperar al sync.
    // Si Odoo no deja (sin correo, en uso, o ni contesta), la cuenta se queda como estaba.
    await prisma.appUser.update({ where: { id: userId }, data: { emailFijado: false } });
    const r = await resincronizarUno(usuario.odooPartnerId).catch(() => ({ ok: false, mensaje: 'Odoo no responde.' }));
    if (!r.ok) {
      await prisma.appUser.update({ where: { id: userId }, data: { emailFijado: true } });
      throw new CorreoNoValido(`No se pudo volver al correo de Odoo: ${r.mensaje}`);
    }
    const ahora = await prisma.appUser.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    final = { email: ahora.email, emailFijado: false };
  } else {
    const crudo = correo.trim();
    if (!esEmailPlausible(crudo)) throw new CorreoNoValido('Ese correo no tiene forma válida.');
    const email = normalizarEmail(crudo);
    const otro = await prisma.appUser.findUnique({ where: { email }, select: { id: true } });
    if (otro && otro.id !== userId) throw new CorreoNoValido('Ese correo ya lo usa otra cuenta del panel.');
    await prisma.appUser.update({ where: { id: userId }, data: { email, emailFijado: true } });
    final = { email, emailFijado: true };
  }

  if (final.email !== usuario.email) {
    await prisma.authToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  }

  recordAudit({
    action: 'user.correo_acceso',
    actorId,
    actorOdooUserId: null,
    targetType: 'AppUser',
    targetId: userId,
    ip: ip ?? null,
    metadata: { antes: usuario.email, despues: final.email, fijado: final.emailFijado },
  });

  return final;
}
