import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Sesión del panel.
 *
 * Los tokens viven en cookies **httpOnly**: el JavaScript del navegador no puede
 * leerlos, así que un XSS no se los lleva. Y como solo el servidor de Next habla
 * con el middleware, el access token nunca llega al cliente.
 *
 * Hay DOS cookies y no una:
 *
 *   · `asta_at` — access token, 15 min. Es el que se manda en cada llamada.
 *   · `asta_rt` — refresh token, 30 días. Solo lo usa `middleware.ts` para
 *     renovar el anterior, y su `path` lo acota a esa ruta.
 *
 * Separarlas permite que la de refresco no viaje en cada petición del panel,
 * que es el punto de tener un access token corto.
 */

export const COOKIE_ACCESS = 'asta_at';
export const COOKIE_REFRESH = 'asta_rt';
export const COOKIE_USER = 'asta_u';

export interface Session {
  accessToken: string;
  usuario: { id: string; nombre: string; role: string };
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const accessToken = store.get(COOKIE_ACCESS)?.value;
  const raw = store.get(COOKIE_USER)?.value;
  if (!accessToken || !raw) return null;

  try {
    const u = JSON.parse(raw) as { id?: unknown; nombre?: unknown; role?: unknown };
    if (typeof u.id !== 'string' || typeof u.role !== 'string') return null;
    return {
      accessToken,
      usuario: { id: u.id, nombre: String(u.nombre ?? ''), role: u.role },
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

const base = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

export async function setSession(datos: {
  accessToken: string;
  refreshToken: string;
  expiraEn: number;
  usuario: { id: string; nombre: string; role: string };
}): Promise<void> {
  const store = await cookies();

  // Un margen de 30 s por debajo de la caducidad real: si la cookie muriera
  // exactamente a la vez que el token, habría una ventana en la que el panel
  // cree tener sesión y el middleware ya la rechaza.
  store.set(COOKIE_ACCESS, datos.accessToken, {
    ...base,
    path: '/',
    maxAge: Math.max(30, datos.expiraEn - 30),
  });
  store.set(COOKIE_REFRESH, datos.refreshToken, {
    ...base,
    path: '/',
    maxAge: 30 * 86_400,
  });
  // Esta NO es httpOnly-crítica: solo lleva nombre y rol para pintar la barra.
  // Aun así va httpOnly, porque el cliente no la necesita: la lee el servidor.
  store.set(COOKIE_USER, JSON.stringify(datos.usuario), {
    ...base,
    path: '/',
    maxAge: 30 * 86_400,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  for (const c of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_USER]) {
    store.delete(c);
  }
}
