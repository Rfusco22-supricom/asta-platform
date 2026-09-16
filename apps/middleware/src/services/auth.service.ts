import type { Prisma } from '@prisma/client';
import type { AppRole } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { authEnv } from '../config/authEnv.js';
import { normalizarEmail } from '../auth/email.js';
import { hashPassword, necesitaRehash, verifyPassword } from '../auth/password.js';
import { caducaEnDias, emitirSecreto, hashSecreto } from '../auth/tokens.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { recordAudit } from './audit.service.js';
import { autenticarEnOdoo, searchRead } from '../odoo/client.js';

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
  | 'SIN_CONTRASENA'
  /** Personal sin contraseña del panel, y Odoo no contestó: no se sabe si la de Odoo era buena. */
  | 'ODOO_NO_DISPONIBLE';

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

/** Hash de una contraseña que no existe: iguala el tiempo de respuesta. Ver `loginLocal`. */
const HASH_FALSO = '$argon2id$v=19$m=65536,t=3,p=1$c2VuaHVlbGFmYWxzYQ$0000000000000000000000000000000000000000000';

type UsuarioLogin = NonNullable<Awaited<ReturnType<typeof buscarPorEmail>>>;

function buscarPorEmail(email: string) {
  return prisma.appUser.findUnique({ where: { email }, include: { credentials: true } });
}

/**
 * Personal = puede entrar con la contraseña de Odoo (#85): VENDEDOR o SUPERADMIN
 * con su `res.users` enlazado. Los clientes no tienen usuario de Odoo —son un
 * `res.partner`— y siguen solo con la contraseña del panel.
 */
function esPersonal(u: { role: AppRole; odooUserId: number | null }): u is typeof u & { odooUserId: number } {
  return (u.role === 'VENDEDOR' || u.role === 'SUPERADMIN') && u.odooUserId !== null;
}

/**
 * El login de Odoo no tiene por qué ser el correo de la cuenta del panel:
 * `ventas08@supricom.com` en Odoo puede ser `ventas08@supricom.com.ve` aquí. Si lo
 * tecleado no es el correo de nadie, se busca como login de Odoo y se enlaza por
 * `odoo_user_id`, que es lo que identifica a la persona.
 *
 * Solo encuentra PERSONAL. Si Odoo no responde, no encuentra nada: quien teclee
 * su correo del panel sigue pudiendo entrar con la contraseña del panel.
 */
async function personalPorLoginDeOdoo(login: string): Promise<UsuarioLogin | null> {
  try {
    const usuarios = await searchRead<{ id: number }>('res.users', [['login', '=ilike', login]], ['id'], {
      limit: 2,
      context: { active_test: false },
    });
    if (usuarios.length !== 1) return null;
    const u = await prisma.appUser.findUnique({ where: { odooUserId: usuarios[0].id }, include: { credentials: true } });
    return u && esPersonal(u) ? u : null;
  } catch {
    return null;
  }
}

/** El `res.users` de la persona, leído con el usuario de servicio. Lanza si Odoo no responde. */
async function usuarioDeOdoo(uid: number): Promise<{ login: string; active: boolean } | null> {
  const [u] = await searchRead<{ login: string; active: boolean }>('res.users', [['id', '=', uid]], ['login', 'active'], {
    context: { active_test: false },
  });
  return u ?? null;
}

/** Solo para la auditoría de un fallo: ¿tiene la verificación en dos pasos? */
async function tieneDosPasos(uid: number): Promise<boolean | null> {
  try {
    const [u] = await searchRead<{ totp_enabled?: boolean }>('res.users', [['id', '=', uid]], ['totp_enabled'], {
      context: { active_test: false },
    });
    return Boolean(u?.totp_enabled);
  } catch {
    return null;
  }
}

export async function login(
  identificador: string,
  contrasena: string,
  ctx: ContextoPeticion = {},
): Promise<SesionEmitida> {
  const email = normalizarEmail(identificador);

  let usuario = await buscarPorEmail(email);
  if (!usuario && authEnv().LOGIN_ODOO) usuario = await personalPorLoginDeOdoo(email);

  if (usuario && esPersonal(usuario)) return loginPersonal(usuario, email, contrasena, ctx);
  return loginLocal(usuario, email, contrasena, ctx);
}

// ── Clientes: solo la contraseña del panel ──────────────────────────────────

async function loginLocal(
  usuario: UsuarioLogin | null,
  email: string,
  contrasena: string,
  ctx: ContextoPeticion,
): Promise<SesionEmitida> {
  const e = authEnv();

  // El hash se calcula IGUALMENTE cuando el usuario no existe.
  //
  // Sin esto, un correo desconocido responde en 2 ms y uno conocido en 70, y esa
  // diferencia es medible desde fuera: el formulario pasaría a ser un oráculo de
  // qué cuentas existen, justo lo que el mensaje único pretende evitar.
  if (!usuario || !usuario.credentials) {
    await verifyPassword(HASH_FALSO, contrasena);
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

  if (cred.lockedUntil && cred.lockedUntil > new Date()) throw bloqueada(cred.lockedUntil);

  if (!usuario.isActive) {
    auditarInactiva(usuario, email, ctx);
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
        lockedUntil: bloquear ? new Date(Date.now() + e.LOGIN_LOCKOUT_MINUTES * 60_000) : null,
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

  // Si los parámetros de Argon2 subieron desde que se creó este hash, se
  // rehashea ahora: es el único momento en que tenemos la contraseña en claro.
  // Sin esto, subir el coste solo protegería a los usuarios futuros.
  const rehash = necesitaRehash(cred.passwordHash) ? await hashPassword(contrasena) : null;

  return emitirSesion(usuario, ctx, cred.mustChange, async (tx) => {
    await tx.userCredential.update({
      where: { userId: usuario.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        ...(rehash ? { passwordHash: rehash, passwordChangedAt: new Date() } : {}),
      },
    });
  });
}

// ── Personal: contraseña de Odoo, o la del panel como respaldo (#85) ────────

/**
 * ── El orden, y por qué ──────────────────────────────────────────────────────
 *
 *   1. Bloqueo. ANTES de preguntar a Odoo: quien aporree este formulario no
 *      puede aporrear con él las cuentas del ERP, ni dejar fuera de Odoo a
 *      quien estaba trabajando.
 *   2. Cuenta desactivada en el panel.
 *   3. Contraseña del panel, si la tiene. Es el respaldo para cuando Odoo no
 *      responde, y no cuesta un viaje al ERP. Pero si Odoo SÍ responde y dice
 *      que la persona está de baja, no entra: el respaldo no puede reabrir el
 *      agujero de revocación que cierra el login con Odoo.
 *   4. Contraseña de Odoo, contra el `login` de su `res.users`.
 *
 * Un solo contador de intentos para los dos caminos (`staff_login_guards`).
 *
 * ── Lo que nunca pasa con la contraseña ─────────────────────────────────────
 *
 * No se guarda, no se registra y no va en la auditoría. Solo viaja en la llamada
 * a `authenticate`. Ver `autenticarEnOdoo`.
 */
async function loginPersonal(
  usuario: UsuarioLogin & { odooUserId: number },
  identificador: string,
  contrasena: string,
  ctx: ContextoPeticion,
): Promise<SesionEmitida> {
  const e = authEnv();
  const guard = await prisma.staffLoginGuard.findUnique({ where: { userId: usuario.id } });

  if (guard?.lockedUntil && guard.lockedUntil > new Date()) throw bloqueada(guard.lockedUntil);

  if (!usuario.isActive) {
    auditarInactiva(usuario, identificador, ctx);
    throw new LoginFallido('INACTIVA');
  }

  let via: 'panel' | 'odoo' | null = null;
  let odooCaido = false;
  let deBajaEnOdoo = false;

  const cred = usuario.credentials;
  if (cred && (await verifyPassword(cred.passwordHash, contrasena))) {
    try {
      const enOdoo = await usuarioDeOdoo(usuario.odooUserId);
      if (enOdoo && !enOdoo.active) deBajaEnOdoo = true;
      else via = 'panel';
    } catch {
      // Odoo caído: es justo para lo que existe el respaldo.
      via = 'panel';
    }
  } else if (e.LOGIN_ODOO) {
    try {
      const enOdoo = await usuarioDeOdoo(usuario.odooUserId);
      if (enOdoo) {
        const uid = await autenticarEnOdoo(enOdoo.login, contrasena);
        if (uid === usuario.odooUserId) via = 'odoo';
      }
    } catch {
      odooCaido = true;
    }
  } else {
    // Sin login con Odoo y sin contraseña del panel: mismo coste que comprobar una.
    await verifyPassword(HASH_FALSO, contrasena);
  }

  if (!via) {
    const intentos = (guard?.failedAttempts ?? 0) + 1;
    const bloquear = intentos >= e.LOGIN_MAX_ATTEMPTS;
    const lockedUntil = bloquear ? new Date(Date.now() + e.LOGIN_LOCKOUT_MINUTES * 60_000) : null;
    await prisma.staffLoginGuard.upsert({
      where: { userId: usuario.id },
      create: { userId: usuario.id, failedAttempts: intentos, lockedUntil },
      update: { failedAttempts: intentos, lockedUntil },
    });

    const motivo = deBajaEnOdoo ? 'baja_en_odoo' : odooCaido ? 'odoo_no_disponible' : 'contrasena_incorrecta';
    recordAudit({
      action: 'access.denied.auth',
      actorId: usuario.id,
      actorOdooUserId: usuario.odooUserId,
      targetType: 'email',
      targetId: identificador,
      ip: ctx.ip ?? null,
      metadata: {
        motivo,
        camino: 'personal',
        intentos,
        bloqueada: bloquear,
        // Solo para quien investigue por qué alguien no entra: con la verificación
        // en dos pasos, Odoo rechaza la contraseña aunque sea buena. Al usuario no
        // se le dice, porque le contaría a cualquiera qué cuentas la tienen.
        ...(motivo === 'contrasena_incorrecta' && e.LOGIN_ODOO ? { dosPasosEnOdoo: await tieneDosPasos(usuario.odooUserId) } : {}),
      },
    });

    if (odooCaido && !cred) {
      throw new LoginFallido(
        'ODOO_NO_DISPONIBLE',
        'No se pudo comprobar la contraseña con Odoo. Inténtalo en unos minutos, o entra con la contraseña del panel si tienes una.',
      );
    }
    throw new LoginFallido('CREDENCIALES');
  }

  const rehash = via === 'panel' && cred && necesitaRehash(cred.passwordHash) ? await hashPassword(contrasena) : null;

  // Con la contraseña de Odoo no hay contraseña del panel que obligar a cambiar.
  return emitirSesion(usuario, ctx, via === 'panel' ? (cred?.mustChange ?? false) : false, async (tx) => {
    if (guard) await tx.staffLoginGuard.update({ where: { userId: usuario.id }, data: { failedAttempts: 0, lockedUntil: null } });
    if (rehash) {
      await tx.userCredential.update({ where: { userId: usuario.id }, data: { passwordHash: rehash, passwordChangedAt: new Date() } });
    }
  });
}

// ── Comunes ────────────────────────────────────────────────────────────────

function bloqueada(hasta: Date): LoginFallido {
  const minutos = Math.ceil((hasta.getTime() - Date.now()) / 60_000);
  return new LoginFallido('BLOQUEADA', `Cuenta bloqueada temporalmente. Inténtalo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`);
}

function auditarInactiva(usuario: UsuarioLogin, identificador: string, ctx: ContextoPeticion): void {
  recordAudit({
    action: 'access.denied.auth',
    actorId: usuario.id,
    actorOdooUserId: usuario.odooUserId,
    targetType: 'email',
    targetId: identificador,
    ip: ctx.ip ?? null,
    metadata: { motivo: 'cuenta_inactiva' },
  });
}

async function emitirSesion(
  usuario: UsuarioLogin,
  ctx: ContextoPeticion,
  debeCambiarContrasena: boolean,
  alEntrar: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<SesionEmitida> {
  const e = authEnv();
  const refresh = emitirSecreto();
  const sesion = await prisma.$transaction(async (tx) => {
    await alEntrar(tx);
    await tx.appUser.update({ where: { id: usuario.id }, data: { lastLoginAt: new Date() } });
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
      debeCambiarContrasena,
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
