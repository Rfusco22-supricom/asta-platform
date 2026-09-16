import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente para revisar compatibilidades (#56).
 *
 * Igual que el de invitaciones y notas: los botones son de un componente de
 * cliente, que no puede tener el token de sesión. El navegador llama aquí y este
 * servidor habla con el middleware, que es quien valida el cuerpo y el permiso.
 *
 *   POST  { filas, decision, relacion? }  → decidir sobre una o varias filas
 *   PATCH { cartridgeId, tipo }           → corregir el tipo de un cartucho
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(metodo: 'POST' | 'PATCH', ruta: string, cuerpo: unknown): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  }
  // El rol también lo comprueba el middleware. Aquí solo se ahorra el viaje.
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } }, { status: 403 });
  }

  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => null);
  return proxy('POST', '/api/v1/admin/compatibilidades/productos/revision', cuerpo);
}

export async function PATCH(req: Request) {
  const { cartridgeId, tipo } = ((await req.json().catch(() => null)) ?? {}) as { cartridgeId?: unknown; tipo?: unknown };
  // Va en la ruta del middleware: que no sea un número no puede componer otra URL.
  if (typeof cartridgeId !== 'number' || !Number.isInteger(cartridgeId) || cartridgeId <= 0) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Cartucho no válido.' } }, { status: 400 });
  }
  return proxy('PATCH', `/api/v1/admin/compatibilidades/cartuchos/${cartridgeId}`, { tipo });
}
