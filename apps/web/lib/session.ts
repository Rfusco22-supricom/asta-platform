import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Sesión del panel.
 *
 * PROVISIONAL. Hoy la cookie guarda un `res.users.id` de Odoo sin verificar
 * nada: es el equivalente en el panel del `authDev` del middleware, y existe
 * por el mismo motivo — poder construir y probar la Fase 3 antes de que estén
 * la autenticación propia (#17, #51, #52) y MySQL.
 *
 * Cuando exista el login real, la cookie pasa a guardar el JWT y este archivo
 * es lo único que cambia: las páginas siguen llamando a `requireSession()` sin
 * enterarse.
 *
 * La cookie es httpOnly a propósito aunque hoy no proteja gran cosa. Es la
 * forma correcta y así el día que guarde un token de verdad ya está bien.
 */

const COOKIE = 'asta_dev_session';

export interface Session {
  odooUserId: number;
  nombre: string;
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { odooUserId: unknown; nombre: unknown };
    const id = Number(parsed.odooUserId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { odooUserId: id, nombre: String(parsed.nombre ?? `Usuario ${id}`) };
  } catch {
    return null;
  }
}

/** Para páginas que no tienen sentido sin sesión. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export async function setSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8, // una jornada
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
