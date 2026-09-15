import { prisma } from '../config/prisma.js';
import { emitirSecreto, hashSecreto, caducaEnDias, haCaducado } from '../auth/tokens.js';
import { evaluarFortaleza, hashPassword } from '../auth/password.js';
import { recordAudit } from './audit.service.js';

/**
 * Invitaciones (issue #16).
 *
 * ── Por qué existe esto antes que el correo ──────────────────────────────────
 *
 * Tras el primer sync hay 2259 cuentas de cliente y CERO contraseñas: nadie
 * puede entrar. El envío por correo está bloqueado por SMTP, pero el correo solo
 * es el **transporte**. Generar el token, validarlo y dejar que el usuario ponga
 * su contraseña es exactamente lo mismo con o sin él.
 *
 * Así que el flujo se construye entero y el enlace se le da al administrador
 * para que lo entregue como pueda. Cuando haya SMTP se añade el envío y nada de
 * esto cambia.
 *
 * SINCERIDAD SOBRE EL ALCANCE: esto sirve para dar de alta a unos pocos clientes
 * a mano. Para los 2259 hace falta el correo — copiar 2259 enlaces no es un
 * plan.
 *
 * ── El token ─────────────────────────────────────────────────────────────────
 *
 * Se guarda el HASH, nunca el token. Quien lea `auth_tokens` no puede aceptar
 * invitaciones ajenas. Es de un solo uso (`used_at`) y caduca a los 7 días.
 */

export const INVITACION_DIAS = 7;

export interface InvitacionEmitida {
  /** El enlace completo. Se muestra UNA vez; no se puede recuperar después. */
  url: string;
  expiraEl: Date;
  usuario: { id: string; email: string; nombre: string };
}

export class InvitacionInvalida extends Error {
  readonly status = 400;
  readonly code = 'NOT_FOUND';

  constructor(readonly motivo: 'desconocida' | 'usada' | 'caducada' | 'usuario_inactivo') {
    // Un mensaje único: distinguir "no existe" de "ya se usó" le diría a quien
    // prueba tokens al azar cuándo ha acertado uno.
    super('Esta invitación no es válida o ya caducó. Pide una nueva.');
    this.name = 'InvitacionInvalida';
  }
}

/**
 * Crea una invitación para un usuario existente.
 *
 * Invalida las anteriores sin usar: tener dos enlaces vivos para la misma
 * persona significa que revocar uno no sirve de nada.
 */
export async function crearInvitacion(
  userId: string,
  baseUrl: string,
  actorId: string | null,
  ip?: string,
): Promise<InvitacionEmitida> {
  const usuario = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, isActive: true },
  });
  if (!usuario) throw new InvitacionInvalida('desconocida');

  const secreto = emitirSecreto();
  const expiraEl = caducaEnDias(INVITACION_DIAS);

  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId, purpose: 'INVITE', usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        userId,
        purpose: 'INVITE',
        tokenHash: secreto.hash,
        expiresAt: expiraEl,
        createdIp: ip,
      },
    }),
  ]);

  recordAudit({
    action: 'user.invitado',
    actorId,
    actorOdooUserId: null,
    targetType: 'AppUser',
    targetId: userId,
    ip: ip ?? null,
    metadata: { email: usuario.email, expiraEl: expiraEl.toISOString() },
  });

  return {
    url: `${baseUrl.replace(/\/$/, '')}/invitacion/${secreto.plaintext}`,
    expiraEl,
    usuario: { id: usuario.id, email: usuario.email, nombre: usuario.fullName },
  };
}

/**
 * Comprueba un token SIN gastarlo, para poder pintar el formulario.
 *
 * Devuelve el nombre y el correo: quien tiene el token ya recibió el enlace, así
 * que enseñárselos no revela nada — y ver su propio nombre es lo que le confirma
 * que el enlace es para él y no se lo reenviaron por error.
 */
export async function validarInvitacion(
  token: string,
): Promise<{ email: string; nombre: string; yaTieneContrasena: boolean }> {
  const fila = await prisma.authToken.findUnique({
    where: { tokenHash: hashSecreto(token) },
    include: {
      user: {
        select: {
          email: true,
          fullName: true,
          isActive: true,
          credentials: { select: { userId: true } },
        },
      },
    },
  });

  if (!fila || fila.purpose !== 'INVITE') throw new InvitacionInvalida('desconocida');
  if (fila.usedAt) throw new InvitacionInvalida('usada');
  if (haCaducado(fila.expiresAt)) throw new InvitacionInvalida('caducada');
  if (!fila.user.isActive) throw new InvitacionInvalida('usuario_inactivo');

  return {
    email: fila.user.email,
    nombre: fila.user.fullName,
    yaTieneContrasena: Boolean(fila.user.credentials),
  };
}

export class ContrasenaDebil extends Error {
  readonly status = 400;
  readonly code = 'VALIDATION_ERROR';

  constructor(readonly motivos: string[]) {
    super(motivos.join(' '));
    this.name = 'ContrasenaDebil';
  }
}

/**
 * Acepta la invitación: establece la contraseña y gasta el token.
 *
 * Todo en una transacción. Si el token se marcara como usado y luego fallara el
 * guardado de la contraseña, el usuario se quedaría sin enlace Y sin poder
 * entrar — el peor de los dos mundos.
 */
export async function aceptarInvitacion(
  token: string,
  contrasena: string,
  ip?: string,
): Promise<{ email: string }> {
  const hashToken = hashSecreto(token);

  const fila = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken },
    include: { user: { select: { id: true, email: true, fullName: true, isActive: true } } },
  });

  if (!fila || fila.purpose !== 'INVITE') throw new InvitacionInvalida('desconocida');
  if (fila.usedAt) throw new InvitacionInvalida('usada');
  if (haCaducado(fila.expiresAt)) throw new InvitacionInvalida('caducada');
  if (!fila.user.isActive) throw new InvitacionInvalida('usuario_inactivo');

  const fortaleza = evaluarFortaleza(contrasena, [fila.user.email, fila.user.fullName]);
  if (!fortaleza.ok) throw new ContrasenaDebil(fortaleza.motivos);

  const hash = await hashPassword(contrasena);

  await prisma.$transaction([
    prisma.userCredential.upsert({
      where: { userId: fila.user.id },
      create: { userId: fila.user.id, passwordHash: hash, mustChange: false },
      update: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChange: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.authToken.update({
      where: { id: fila.id },
      data: { usedAt: new Date() },
    }),
    // Cualquier sesión previa se cierra. Si la cuenta ya tenía contraseña y
    // alguien está usando la invitación para recuperarla, dejar vivas las
    // sesiones anteriores dejaría dentro a quien no debe.
    prisma.userSession.updateMany({
      where: { userId: fila.user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_changed' },
    }),
  ]);

  recordAudit({
    action: 'user.invitacion_aceptada',
    actorId: fila.user.id,
    actorOdooUserId: null,
    targetType: 'AppUser',
    targetId: fila.user.id,
    ip: ip ?? null,
    metadata: { email: fila.user.email },
  });

  return { email: fila.user.email };
}

/** Candidatos a invitar: cuentas activas que todavía no pueden entrar. */
export interface SinAcceso {
  id: string;
  email: string;
  nombre: string;
  role: string;
  invitacionPendiente: boolean;
}

/**
 * Devuelve la lista acotada Y el total.
 *
 * El total no sobra: la lista viene limitada para no traerse cientos de filas a
 * una pantalla donde se actúa de una en una, y enseñar «25 pendientes» cuando
 * hay 2.271 haría creer que el trabajo se acabó.
 *
 * Antes ese total salía del informe de reconciliación, que recorre Odoo entero y
 * está limitado por frecuencia. Al separar «Usuarios» en su propia sección, dos
 * pantallas pasaron a pedir ese informe y la segunda se comía un «Espera unos
 * minutos entre sincronizaciones». Un contador no puede costar un barrido del
 * ERP.
 */
export async function listarSinAcceso(
  limite = 50,
): Promise<{ usuarios: SinAcceso[]; total: number }> {
  const [usuarios, total] = await Promise.all([
    prisma.appUser.findMany({
      where: { isActive: true, credentials: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        authTokens: {
          where: { purpose: 'INVITE', usedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { fullName: 'asc' },
      take: limite,
    }),
    prisma.appUser.count({ where: { isActive: true, credentials: null } }),
  ]);

  return {
    usuarios: usuarios.map((u) => ({
      id: u.id,
      email: u.email,
      nombre: u.fullName,
      role: u.role,
      invitacionPendiente: u.authTokens.length > 0,
    })),
    total,
  };
}
