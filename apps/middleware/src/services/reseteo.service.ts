import { prisma } from '../config/prisma.js';
import { normalizarEmail } from '../auth/email.js';
import { caducaEnMinutos, emitirSecreto, haCaducado, hashSecreto } from '../auth/tokens.js';
import { evaluarFortaleza, hashPassword } from '../auth/password.js';
import { recordAudit } from './audit.service.js';
import { enviarCorreo, plantillaReseteo } from './correo.service.js';
import { ContrasenaDebil } from './invitation.service.js';

/**
 * «Olvidé mi contraseña» (#53).
 *
 * ── A quién le sirve ─────────────────────────────────────────────────────────
 *
 * Sobre todo a los clientes. El personal entra con su contraseña de Odoo (#85) y
 * la recupera en Odoo; aquí solo restablece la del panel, que es el respaldo.
 *
 * ── La respuesta es siempre la misma ─────────────────────────────────────────
 *
 * Exista o no la cuenta, la ruta contesta lo mismo y en el mismo tiempo: el
 * trabajo (buscar, crear el token, enviar) se hace DESPUÉS de responder. Si no,
 * el formulario sería un verificador de qué correos tienen cuenta, que es lo que
 * busca quien prepara un phishing.
 *
 * ── El token ─────────────────────────────────────────────────────────────────
 *
 * Igual que las invitaciones (#16): se guarda el hash, caduca en una hora, sirve
 * una vez, y pedir otro invalida los anteriores. Al usarlo se cierran todas las
 * sesiones: si alguien la estaba usando sin permiso, se queda fuera.
 */

export const RESETEO_MINUTOS = 60;

/**
 * Cuántos correos de reseteo puede recibir una dirección por hora.
 *
 * El límite por IP de la ruta frena a quien aporrea desde un sitio; esto frena
 * a quien usa el formulario para llenarle el buzón a una persona concreta desde
 * muchas IPs. Pasado el límite no se envía nada, y la respuesta no cambia.
 */
export const RESETEOS_POR_HORA = 3;

export class ReseteoInvalido extends Error {
  readonly status = 400;
  readonly code = 'NOT_FOUND';

  constructor(readonly motivo: 'desconocido' | 'usado' | 'caducado' | 'usuario_inactivo') {
    // Un mensaje único, por lo mismo que las invitaciones: distinguir «no
    // existe» de «ya se usó» diría a quien prueba tokens cuándo acertó.
    super('Este enlace no es válido o ya caducó. Pide uno nuevo.');
    this.name = 'ReseteoInvalido';
  }
}

export type ResultadoSolicitud = 'enviado' | 'sin_smtp' | 'sin_cuenta' | 'inactiva' | 'limite';

/**
 * Crea el token y manda el correo. Lo llama la ruta SIN esperar: el resultado
 * es para los tests y la auditoría, nunca para la respuesta.
 */
export async function solicitarReseteo(emailTecleado: string, baseUrl: string, ip?: string): Promise<ResultadoSolicitud> {
  const email = normalizarEmail(emailTecleado);
  const usuario = await prisma.appUser.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, isActive: true, odooUserId: true },
  });

  const auditar = (resultado: ResultadoSolicitud) =>
    recordAudit({
      action: 'auth.reseteo_solicitado',
      actorId: null,
      actorOdooUserId: null,
      targetType: usuario ? 'AppUser' : null,
      targetId: usuario?.id ?? null,
      ip: ip ?? null,
      // El correo tecleado, para poder ver quién intenta qué. Nunca el token.
      metadata: { email, resultado },
    });

  if (!usuario) {
    auditar('sin_cuenta');
    return 'sin_cuenta';
  }
  if (!usuario.isActive) {
    auditar('inactiva');
    return 'inactiva';
  }

  const haceUnaHora = new Date(Date.now() - 60 * 60_000);
  const recientes = await prisma.authToken.count({
    where: { userId: usuario.id, purpose: 'PASSWORD_RESET', createdAt: { gte: haceUnaHora } },
  });
  if (recientes >= RESETEOS_POR_HORA) {
    auditar('limite');
    return 'limite';
  }

  const secreto = emitirSecreto();
  await prisma.$transaction([
    // Tener dos enlaces vivos significaría que el viejo, si alguien lo vio,
    // seguiría sirviendo después de pedir uno nuevo.
    prisma.authToken.updateMany({
      where: { userId: usuario.id, purpose: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        userId: usuario.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: secreto.hash,
        expiresAt: caducaEnMinutos(RESETEO_MINUTOS),
        createdIp: ip,
      },
    }),
  ]);

  const { enviado } = await enviarCorreo(
    plantillaReseteo({
      para: usuario.email,
      nombre: usuario.fullName,
      url: `${baseUrl.replace(/\/$/, '')}/restablecer/${secreto.plaintext}`,
      minutos: RESETEO_MINUTOS,
      esPersonal: usuario.odooUserId !== null,
    }),
  );

  const resultado: ResultadoSolicitud = enviado ? 'enviado' : 'sin_smtp';
  auditar(resultado);
  return resultado;
}

async function tokenVigente(token: string) {
  const fila = await prisma.authToken.findUnique({
    where: { tokenHash: hashSecreto(token) },
    include: { user: { select: { id: true, email: true, fullName: true, isActive: true } } },
  });
  if (!fila || fila.purpose !== 'PASSWORD_RESET') throw new ReseteoInvalido('desconocido');
  if (fila.usedAt) throw new ReseteoInvalido('usado');
  if (haCaducado(fila.expiresAt)) throw new ReseteoInvalido('caducado');
  if (!fila.user.isActive) throw new ReseteoInvalido('usuario_inactivo');
  return fila;
}

/** Comprueba el enlace SIN gastarlo, para pintar el formulario. */
export async function validarReseteo(token: string): Promise<{ email: string; nombre: string }> {
  const fila = await tokenVigente(token);
  return { email: fila.user.email, nombre: fila.user.fullName };
}

/**
 * Fija la contraseña nueva, gasta el token y cierra todas las sesiones, en una
 * transacción: si se gastara el token y fallara el guardado, la persona se
 * quedaría sin enlace y sin poder entrar.
 */
export async function restablecerContrasena(token: string, contrasena: string, ip?: string): Promise<{ email: string }> {
  const fila = await tokenVigente(token);

  const fortaleza = evaluarFortaleza(contrasena, [fila.user.email, fila.user.fullName]);
  if (!fortaleza.ok) throw new ContrasenaDebil(fortaleza.motivos);

  const hash = await hashPassword(contrasena);
  const ahora = new Date();

  await prisma.$transaction([
    prisma.userCredential.upsert({
      where: { userId: fila.user.id },
      create: { userId: fila.user.id, passwordHash: hash, mustChange: false },
      update: { passwordHash: hash, passwordChangedAt: ahora, mustChange: false, failedAttempts: 0, lockedUntil: null },
    }),
    // El contador del personal (#85) también: quien se bloqueó probando y
    // acaba de demostrar que tiene el correo no debería seguir fuera.
    prisma.staffLoginGuard.updateMany({ where: { userId: fila.user.id }, data: { failedAttempts: 0, lockedUntil: null } }),
    prisma.authToken.update({ where: { id: fila.id }, data: { usedAt: ahora } }),
    prisma.userSession.updateMany({
      where: { userId: fila.user.id, revokedAt: null },
      data: { revokedAt: ahora, revokedReason: 'password_reset' },
    }),
  ]);

  recordAudit({
    action: 'auth.contrasena_restablecida',
    actorId: fila.user.id,
    actorOdooUserId: null,
    targetType: 'AppUser',
    targetId: fila.user.id,
    ip: ip ?? null,
    metadata: { email: fila.user.email },
  });

  return { email: fila.user.email };
}
