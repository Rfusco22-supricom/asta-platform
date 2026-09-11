import type { AppRole } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { authEnv } from '../config/authEnv.js';
import { normalizarEmail } from '../auth/email.js';
import { hashPassword, necesitaRehash, verifyPassword } from '../auth/password.js';
import { caducaEnDias, emitirSecreto, hashSecreto } from '../auth/tokens.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { recordAudit } from './audit.service.js';

/**
 * Login, refresco y cierre de sesión.
 *
 * Reemplaza a Supabase Auth. Las piezas criptográficas viven en `auth/*`; aquí
 * está lo que toca la base de datos y las reglas.
 */

export interface ContextoPeticion {
  ip?: string;
  userAgent?: string;
}

export interface SesionEmitida {
  accessToken: string;
  refreshToken: string;
  expiraEn: number;
  usuario: {
    id: string;
    email: string;
    nombre: string;
    role: AppRole;
    debeCambiarContrasena: boolean;
  };
}

export type MotivoFallo =
  | 'CREDENCIALES'
  | 'BLOQUEADA'
  | 'INACTIVA'
  | 'SIN_CONTRASENA';

export class LoginFallido extends Error {
  readonly status = 401;
  readonly code = 'UNAUTHENTICATED';

  constructor(readonly motivo: MotivoFallo, mensaje?: string) {
    // Mensaje ÚNICO hacia fuera para casi todos los motivos.
    //
    // Distinguir "ese correo no existe" de "la contraseña es incorrecta"
    // convierte el formulario en un verificador de qué correos tienen cuenta,
    // que es justo lo que busca quien prepara un phishing dirigido.
    //
    // El bloqueo SÍ se dice: el usuario tiene que entender por qué no entra
    // aunque escriba bien, y a esas alturas el atacante ya sabe que la cuenta
    // existe — se lo acaba de decir su propio ataque.
    super(mensaje ?? 'Correo o contraseña incorrectos.');
    this.name = 'LoginFallido';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

export async function login(
  emailCrudo: string,
  contrasena: string,
  ctx: ContextoPeticion = {},
): Promise<SesionEmitida> {
  const e = authEnv();
  const email = normalizarEmail(emailCrudo);

  const usuario = await prisma.appUser.findUnique({
    where: { email },
    include: { credentials: true },
  });

  // El hash se calcula IGUALMENTE cuando el usuario no existe.
  //
  // Sin esto, un correo desconocido responde en 2 ms y uno conocido en 70, y esa
  // diferencia es medible desde fuera: el formulario pasaría a ser un oráculo de
  // qué cuentas existen, justo lo que el mensaje único pretende evitar.
  if (!usuario || !usuario.credentials) {
    await verifyPassword(
      '$argon2id$v=19$m=65536,t=3,p=1$c2VuaHVlbGFmYWxzYQ$0000000000000000000000000000000000000000000',
      contrasena,
    );
    recordAudit({
      action: 'access.denied.auth',
      actorId: null,
      actorOdooUserId: null,
      targetType: 'email',
      targetId: email,
      ip: ctx.ip ?? null,
      metadata: { motivo: usuario ? 'sin_contrasena' : 'email_desconocido' },
    });
    throw new LoginFallido(usuario ? 'SIN_CONTRASENA' : 'CREDENCIALES');
  }

  const cred = usuario.credentials;

  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    const minutos = Math.ceil((cred.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new LoginFallido(
      'BLOQUEADA',
      `Cuenta bloqueada temporalmente. Inténtalo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
    );
  }

  if (!usuario.isActive) {
    recordAudit({
      action: 'access.denied.auth',
      actorId: usuario.id,
      actorOdooUserId: usuario.odooUserId,
      targetType: 'email',
      targetId: email,
      ip: ctx.ip ?? null,
      metadata: { motivo: 'cuenta_inactiva' },
    });
    // Mensaje genérico: que la cuenta esté desactivada tampoco es asunto de
    // quien no puede demostrar que es su dueño.
    throw new LoginFallido('INACTIVA');
  }

  const correcta = await verifyPassword(cred.passwordHash, contrasena);

  if (!correcta) {
    const intentos = cred.failedAttempts + 1;
    const bloquear = intentos >= e.LOGIN_MAX_ATTEMPTS;

    await prisma.userCredential.update({
      where: { userId: usuario.id },
      data: {
        failedAttempts: intentos,
        lockedUntil: bloquear
          ? new Date(Date.now() + e.LOGIN_LOCKOUT_MINUTES * 60_000)
          : null,
      },
    });

    recordAudit({
      action: 'access.denied.auth',
      actorId: usuario.id,
      actorOdooUserId: usuario.odooUserId,
      targetType: 'email',
      targetId: email,
      ip: ctx.ip ?? null,
      metadata: { motivo: 'contrasena_incorrecta', intentos, bloqueada: bloquear },
    });

    throw new LoginFallido('CREDENCIALES');
  }

  // ── Correcta ──────────────────────────────────────────────────────────────

  // Si los parámetros de Argon2 subieron desde que se creó este hash, se
  // rehashea ahora: es el único momento en que tenemos la contraseña en claro.
  // Sin esto, subir el coste solo protegería a los usuarios futuros.
  const rehash = necesitaRehash(cred.passwordHash)
    ? await hashPassword(contrasena)
    : null;

  const refresh = emitirSecreto();
  const sesion = await prisma.$transaction(async (tx) => {
    await tx.userCredential.update({
      where: { userId: usuario.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        ...(rehash ? { passwordHash: rehash, passwordChangedAt: new Date() } : {}),
      },
    });

    await tx.appUser.update({
      where: { id: usuario.id },
      data: { lastLoginAt: new Date() },
    });

    return tx.userSession.create({
      data: {
        userId: usuario.id,
        refreshTokenHash: refresh.hash,
        expiresAt: caducaEnDias(e.JWT_REFRESH_TTL_DAYS),
        userAgent: ctx.userAgent?.slice(0, 500),
        ip: ctx.ip,
      },
      select: { id: true },
    });
  });

  const accessToken = await emitirAccessToken({
    sub: usuario.id,
    role: usuario.role,
    odooPartnerId: usuario.odooPartnerId,
    odooUserId: usuario.odooUserId,
    sid: sesion.id,
  });

  return {
    accessToken,
    refreshToken: refresh.plaintext,
    expiraEn: 15 * 60,
    usuario: {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.fullName,
      role: usuario.role,
      debeCambiarContrasena: cred.mustChange,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresco con rotación
// ─────────────────────────────────────────────────────────────────────────────

export class RefreshInvalido extends Error {
  readonly status = 401;
  readonly code = 'TOKEN_EXPIRED';

  constructor(readonly motivo: 'desconocido' | 'revocado' | 'expirado' | 'reuso') {
    super('Sesión no válida. Vuelve a iniciar sesión.');
    this.name = 'RefreshInvalido';
  }
}

/**
 * Canjea un refresh token por un par nuevo, ROTANDO el anterior.
 *
 * Rotar significa que cada refresh token sirve una sola vez. Eso permite lo
 * importante: **detectar el reuso**. Si llega un token que ya se canjeó, hay dos
 * explicaciones —lo robaron y el ladrón lo está usando, o lo robaron y el
 * legítimo lo está usando— y en ambas alguien tiene una copia que no debería.
 *
 * La respuesta es revocar TODAS las sesiones del usuario. Es agresivo: obliga a
 * volver a entrar en todos sus dispositivos. Pero la alternativa es dejar viva
 * una sesión robada, y eso no es una alternativa.
 */
export async function refrescar(
  refreshToken: string,
  ctx: ContextoPeticion = {},
): Promise<SesionEmitida> {
  const e = authEnv();
  const hash = hashSecreto(refreshToken);

  const sesion = await prisma.userSession.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: { include: { credentials: { select: { mustChange: true } } } } },
  });

  if (!sesion) throw new RefreshInvalido('desconocido');

  if (sesion.revokedAt) {
    // Un token ya rotado que vuelve a aparecer es la señal clásica de robo.
    if (sesion.revokedReason === 'rotated') {
      await prisma.userSession.updateMany({
        where: { userId: sesion.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'reuse_detected' },
      });
      recordAudit({
        action: 'access.denied.auth',
        actorId: sesion.userId,
        actorOdooUserId: sesion.user.odooUserId,
        targetType: 'UserSession',
        targetId: sesion.id,
        ip: ctx.ip ?? null,
        metadata: { motivo: 'refresh_token_reutilizado', accion: 'revocadas_todas_las_sesiones' },
      });
      throw new RefreshInvalido('reuso');
    }
    throw new RefreshInvalido('revocado');
  }

  if (sesion.expiresAt <= new Date()) throw new RefreshInvalido('expirado');
  if (!sesion.user.isActive) throw new RefreshInvalido('revocado');

  const nuevo = emitirSecreto();
  const nuevaSesion = await prisma.$transaction(async (tx) => {
    await tx.userSession.update({
      where: { id: sesion.id },
      data: { revokedAt: new Date(), revokedReason: 'rotated', lastUsedAt: new Date() },
    });
    return tx.userSession.create({
      data: {
        userId: sesion.userId,
        refreshTokenHash: nuevo.hash,
        // La caducidad NO se renueva desde cero en cada refresco: se hereda de
        // la sesión original. Si no, una sesión activa sería eterna.
        expiresAt: sesion.expiresAt,
        userAgent: ctx.userAgent?.slice(0, 500) ?? sesion.userAgent,
        ip: ctx.ip ?? sesion.ip,
      },
      select: { id: true },
    });
  });

  const accessToken = await emitirAccessToken({
    sub: sesion.user.id,
    role: sesion.user.role,
    odooPartnerId: sesion.user.odooPartnerId,
    odooUserId: sesion.user.odooUserId,
    sid: nuevaSesion.id,
  });

  void e;
  return {
    accessToken,
    refreshToken: nuevo.plaintext,
    expiraEn: 15 * 60,
    usuario: {
      id: sesion.user.id,
      email: sesion.user.email,
      nombre: sesion.user.fullName,
      role: sesion.user.role,
      debeCambiarContrasena: sesion.user.credentials?.mustChange ?? false,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre
// ─────────────────────────────────────────────────────────────────────────────

export async function cerrarSesion(refreshToken: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { refreshTokenHash: hashSecreto(refreshToken), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'logout' },
  });
}

/** Cierra todas las sesiones. Se llama al cambiar la contraseña. */
export async function cerrarTodasLasSesiones(
  userId: string,
  motivo = 'admin_revoked',
): Promise<number> {
  const r = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: motivo },
  });
  return r.count;
}

/**
 * Cambia la contraseña y cierra TODAS las sesiones.
 *
 * Cerrarlas no es opcional: si alguien cambia su contraseña porque sospecha que
 * se la robaron, dejar vivas las sesiones del ladrón hace que el cambio no sirva
 * de nada.
 */
export async function cambiarContrasena(
  userId: string,
  nueva: string,
): Promise<void> {
  const hash = await hashPassword(nueva);

  await prisma.$transaction([
    prisma.userCredential.update({
      where: { userId },
      data: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChange: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'password_changed' },
    }),
  ]);
}
