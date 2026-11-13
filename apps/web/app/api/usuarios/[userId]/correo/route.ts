import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente para fijar el correo de acceso de un cliente (o volver al de Odoo).
 * Como el de invitar: el navegador no tiene el token de sesión, así que el
 * clic llega aquí y desde aquí se llama al middleware, que es quien decide.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } }, { status: 403 });
  }
  const { userId } = await params;
  const cuerpo = (await req.json().catch(() => null)) as { email?: string | null } | null;
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/admin/users/${encodeURIComponent(userId)}/correo-acceso`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cuerpo?.email ?? null }),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
