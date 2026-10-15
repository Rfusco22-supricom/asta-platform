import type { AppRole } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { recordAudit } from './audit.service.js';

/**
 * Da acceso al panel a alguien del PERSONAL que no es vendedor (#81).
 *
 * `sync-vendedores` crea las cuentas de quien tiene cartera en Odoo. Quien no
 * la tiene —dirección, gerencia— no tenía cómo entrar: el primer administrador
 * sale del seed y no había nada más. Pasó en octubre de 2026 con alguien de gerencia.
 *
 * La cuenta queda atada a su usuario de Odoo (`odoo_user_id`), y por eso entra
 * con su usuario y contraseña de Odoo, como el resto del personal (ver
 * `loginPersonal` en auth.service.ts). No se le pone contraseña del panel.
 *
 * Solo personal interno y activo en Odoo: un usuario del portal (`share`) es
 * un cliente, y uno archivado no debe poder entrar por aquí.
 */

export type RolPersonal = Extract<AppRole, 'SUPERADMIN' | 'VENDEDOR'>;

export interface UsuarioOdoo {
  id: number;
  name: string;
  login: string;
  active: boolean;
  share: boolean;
  partner_id: [number, string] | false;
}

export type ResultadoAcceso =
  | { tipo: 'crear'; email: string; nombre: string; rol: RolPersonal; odooUserId: number }
  | { tipo: 'cambiar'; email: string; nombre: string; rolAnterior: AppRole; rol: RolPersonal; cambios: string[] }
  | { tipo: 'igual'; email: string; nombre: string; rol: RolPersonal };

export class AccesoImposible extends Error {}

/** El `res.users` con ese login. Solo lectura. */
export async function usuarioOdooPorLogin(login: string): Promise<UsuarioOdoo[]> {
  return searchRead<UsuarioOdoo>('res.users', [['login', '=ilike', login.trim()]], ['id', 'name', 'login', 'active', 'share', 'partner_id'], {
    limit: 2,
    context: { active_test: false },
  });
}

export async function darAccesoPersonal(
  opciones: { login: string; rol: RolPersonal; aplicar: boolean; actorId?: string | null },
  buscar: (login: string) => Promise<UsuarioOdoo[]> = usuarioOdooPorLogin,
): Promise<ResultadoAcceso> {
  const encontrados = await buscar(opciones.login);
  if (encontrados.length === 0) throw new AccesoImposible(`No hay ningún usuario de Odoo con el login «${opciones.login}».`);
  if (encontrados.length > 1) throw new AccesoImposible(`Hay más de un usuario de Odoo con el login «${opciones.login}»: no se elige.`);
  const u = encontrados[0]!;
  if (!u.active) throw new AccesoImposible(`El usuario de Odoo ${u.id} está archivado.`);
  if (u.share) throw new AccesoImposible(`El usuario de Odoo ${u.id} es del portal (un cliente), no del personal.`);
  if (!u.partner_id) throw new AccesoImposible(`El usuario de Odoo ${u.id} no tiene contacto (partner).`);

  const email = u.login.trim().toLowerCase();
  const nombre = u.name.trim();
  const partnerId = u.partner_id[0];

  // Las tres claves son únicas en app_users: si apuntan a filas distintas, no se adivina cuál es.
  const filas = await prisma.appUser.findMany({ where: { OR: [{ odooUserId: u.id }, { email }, { odooPartnerId: partnerId }] } });
  if (new Set(filas.map((f) => f.id)).size > 1) {
    throw new AccesoImposible(`El usuario ${u.id}, el correo ${email} y el contacto ${partnerId} están en cuentas distintas del panel: revísalas a mano.`);
  }
  const existente = filas[0];

  if (!existente) {
    if (opciones.aplicar) {
      const creado = await prisma.appUser.create({
        data: { email, fullName: nombre, role: opciones.rol, odooPartnerId: partnerId, odooUserId: u.id, isActive: true },
        select: { id: true },
      });
      recordAudit({
        action: 'personal.acceso',
        actorId: opciones.actorId ?? null,
        actorOdooUserId: null,
        targetType: 'AppUser',
        targetId: creado.id,
        ip: null,
        metadata: { cambio: 'alta', rol: opciones.rol, odooUserId: u.id },
      });
    }
    return { tipo: 'crear', email, nombre, rol: opciones.rol, odooUserId: u.id };
  }

  const cambios = [
    existente.role !== opciones.rol ? `rol ${existente.role} → ${opciones.rol}` : '',
    existente.odooUserId !== u.id ? `usuario de Odoo ${existente.odooUserId ?? '—'} → ${u.id}` : '',
    !existente.isActive ? 'reactivada' : '',
  ].filter(Boolean);
  if (cambios.length === 0) return { tipo: 'igual', email: existente.email, nombre: existente.fullName, rol: opciones.rol };
  if (existente.role !== opciones.rol) {
    if (opciones.actorId && existente.id === opciones.actorId) throw new AccesoImposible('No puedes cambiar tu propio rol.');
    if (existente.role === 'SUPERADMIN' && existente.isActive && (await esElUltimoAdministrador(existente.id))) {
      throw new AccesoImposible('Es el único administrador activo: el panel se quedaría sin nadie que dé accesos.');
    }
  }

  if (opciones.aplicar) {
    await prisma.appUser.update({ where: { id: existente.id }, data: { role: opciones.rol, odooUserId: u.id, isActive: true } });
    recordAudit({
      action: 'personal.acceso',
      actorId: opciones.actorId ?? null,
      actorOdooUserId: null,
      targetType: 'AppUser',
      targetId: existente.id,
      ip: null,
      metadata: { cambio: 'promocion', rolAnterior: existente.role, rol: opciones.rol, odooUserId: u.id },
    });
  }
  return { tipo: 'cambiar', email: existente.email, nombre: existente.fullName, rolAnterior: existente.role, rol: opciones.rol, cambios };
}

// ── Desde el panel: Accesos → Personal ─────────────────────────────────────

/** ¿Es la única cuenta SUPERADMIN activa? Quitarle el rol dejaría el panel sin administrador. */
async function esElUltimoAdministrador(appUserId: string): Promise<boolean> {
  const otros = await prisma.appUser.count({ where: { role: 'SUPERADMIN', isActive: true, NOT: { id: appUserId } } });
  return otros === 0;
}

/** El `res.users` con ese id. Solo lectura. */
export async function usuarioOdooPorId(odooUserId: number): Promise<UsuarioOdoo[]> {
  return searchRead<UsuarioOdoo>('res.users', [['id', '=', odooUserId]], ['id', 'name', 'login', 'active', 'share', 'partner_id'], {
    limit: 1,
    context: { active_test: false },
  });
}

export interface PersonaConAcceso {
  appUserId: string;
  nombre: string;
  email: string;
  rol: RolPersonal;
  /** Null en una cuenta local (la del seed): no se gestiona desde aquí. */
  odooUserId: number | null;
}

/** Quién puede entrar hoy como personal. */
export async function listarConAcceso(): Promise<PersonaConAcceso[]> {
  const filas = await prisma.appUser.findMany({
    where: { role: { in: ['SUPERADMIN', 'VENDEDOR'] }, isActive: true },
    select: { id: true, fullName: true, email: true, role: true, odooUserId: true },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  });
  return filas.map((f) => ({ appUserId: f.id, nombre: f.fullName, email: f.email, rol: f.role as RolPersonal, odooUserId: f.odooUserId }));
}

export interface UsuarioOdooConAcceso {
  odooUserId: number;
  nombre: string;
  login: string;
  /** El rol con el que entra hoy, o null si no tiene acceso. */
  rol: RolPersonal | null;
}

/**
 * Usuarios INTERNOS y activos de Odoo por nombre o login, con su acceso actual.
 * Del portal no salen: son clientes, que entran por su lado.
 */
export async function buscarUsuariosOdoo(q: string, limite = 30): Promise<UsuarioOdooConAcceso[]> {
  const usuarios = await searchRead<UsuarioOdoo>(
    'res.users',
    [['share', '=', false], ['active', '=', true], '|', ['name', 'ilike', q], ['login', 'ilike', q]],
    ['id', 'name', 'login'],
    { limit: limite, order: 'name asc' },
  );
  const cuentas = await prisma.appUser.findMany({
    where: { odooUserId: { in: usuarios.map((u) => u.id) }, role: { in: ['SUPERADMIN', 'VENDEDOR'] }, isActive: true },
    select: { odooUserId: true, role: true },
  });
  const rolDe = new Map(cuentas.map((c) => [c.odooUserId, c.role as RolPersonal]));
  return usuarios.map((u) => ({ odooUserId: u.id, nombre: u.name.trim(), login: u.login, rol: rolDe.get(u.id) ?? null }));
}

/** Dar acceso o cambiar el rol desde el panel. Mismas reglas que `dar-acceso-personal`. */
export async function darAccesoPorId(odooUserId: number, rol: RolPersonal, actorId: string): Promise<ResultadoAcceso> {
  return darAccesoPersonal({ login: String(odooUserId), rol, aplicar: true, actorId }, () => usuarioOdooPorId(odooUserId));
}

/**
 * Quitar el acceso: la cuenta se DESACTIVA y sus sesiones se cierran ya.
 *
 * Desactivar, no borrar ni bajarla a cliente: así no queda ninguna puerta
 * (una contraseña del panel de respaldo entraría como cliente) y se puede
 * devolver el acceso igual que se dio. El sync de clientes no reactiva cuentas.
 */
export async function quitarAccesoPersonal(odooUserId: number, actorId: string): Promise<{ email: string; nombre: string; sesionesCerradas: number }> {
  const cuenta = await prisma.appUser.findFirst({
    where: { odooUserId, role: { in: ['SUPERADMIN', 'VENDEDOR'] }, isActive: true },
    select: { id: true, email: true, fullName: true, role: true },
  });
  if (!cuenta) throw new AccesoImposible('Ese usuario no tiene acceso al panel.');
  if (cuenta.id === actorId) throw new AccesoImposible('No puedes quitarte el acceso a ti mismo.');
  if (cuenta.role === 'SUPERADMIN' && (await esElUltimoAdministrador(cuenta.id))) {
    throw new AccesoImposible('Es el único administrador activo: el panel se quedaría sin nadie que dé accesos.');
  }

  await prisma.appUser.update({ where: { id: cuenta.id }, data: { isActive: false } });
  const { count: sesionesCerradas } = await prisma.userSession.updateMany({
    where: { userId: cuenta.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'acceso_retirado' },
  });
  recordAudit({
    action: 'personal.acceso',
    actorId,
    actorOdooUserId: null,
    targetType: 'AppUser',
    targetId: cuenta.id,
    ip: null,
    metadata: { cambio: 'retirada', rolAnterior: cuenta.role, odooUserId, sesionesCerradas },
  });
  return { email: cuenta.email, nombre: cuenta.fullName, sesionesCerradas };
}
