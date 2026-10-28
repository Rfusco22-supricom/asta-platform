import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del CLIENTE para las tablets de su tienda.
 *
 *   PATCH { id, activo } → activar o desactivar una tablet suya
 *
 * No decide nada: de quién es la tablet lo comprueba el middleware con la
 * sesión, y una ajena responde lo mismo que una que no existe. El listado lo
 * trae el Server Component.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

const idValido = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

export async function PATCH(req: Request) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  const { id, activo } = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown; activo?: unknown };
  if (!idValido(id)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Falta la tablet.' } }, { status: 400 });
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/account/tablets/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo }),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
