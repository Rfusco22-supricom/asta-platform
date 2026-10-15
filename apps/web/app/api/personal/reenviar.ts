import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente hacia `/api/v1/admin/personal` (Accesos → Personal).
 *
 * Como el de invitaciones: el componente que pinta los botones es de cliente y
 * no puede tener el token de sesión, así que el clic llega aquí, al servidor de
 * Next, y desde aquí se llama al middleware. El rol se filtra antes para no
 * gastar un viaje, pero la decisión que vale es la del middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function reenviar(ruta: string, init: { method: 'GET' | 'PUT' | 'DELETE'; body?: unknown }) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } }, { status: 403 });
  }
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/admin/personal${ruta}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${sesion.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
