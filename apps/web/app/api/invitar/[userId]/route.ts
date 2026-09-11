import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente para generar un enlace de invitación.
 *
 * Existe porque el componente que pinta el botón es de cliente y **no puede
 * tener el token de sesión**: todo el panel está construido sobre que el
 * navegador nunca habla con el middleware ni ve credenciales.
 *
 * Así que el clic llega aquí, al servidor de Next, que sí tiene la sesión, y
 * desde aquí se llama al middleware. El token no cruza al navegador en ningún
 * momento.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } },
      { status: 401 },
    );
  }

  // El rol también lo comprueba el middleware. Aquí se filtra antes para no
  // gastar un viaje, pero la decisión que vale es la de allí.
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json(
      { error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } },
      { status: 403 },
    );
  }

  const { userId } = await params;

  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/admin/users/${userId}/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: { code: 'ODOO_UNAVAILABLE', message: 'El middleware no responde.' } },
      { status: 503 },
    );
  }
}
