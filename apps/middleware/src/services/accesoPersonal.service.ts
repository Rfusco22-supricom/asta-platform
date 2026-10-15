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
