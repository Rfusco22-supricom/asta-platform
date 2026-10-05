import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del ADMINISTRADOR para las tablets del kiosco (#120).
 *
 *   POST  { nombre, tienda, odooWarehouseId } → alta; devuelve el token UNA vez
 *   PUT   { id }                              → token nuevo; el anterior deja de valer
 *   PATCH { id, activo }                      → activar o desactivar
 *
 * Como los demás puentes: los botones son de cliente y no tienen el token de sesión.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(ruta: string, metodo: 'POST' | 'PATCH', cuerpo?: unknown): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } }, { status: 403 });
  }
  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}

const idValido = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

export async function POST(req: Request) {
  return proxy('/api/v1/admin/kioscos', 'POST', await req.json().catch(() => null));
}

export async function PUT(req: Request) {
  const { id } = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown };
  if (!idValido(id)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Falta la tablet.' } }, { status: 400 });
  return proxy(`/api/v1/admin/kioscos/${id}/token`, 'POST');
}

export async function PATCH(req: Request) {
  const { id, activo } = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown; activo?: unknown };
  if (!idValido(id)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Falta la tablet.' } }, { status: 400 });
  return proxy(`/api/v1/admin/kioscos/${id}`, 'PATCH', { activo });
}
