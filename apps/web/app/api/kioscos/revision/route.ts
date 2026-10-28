import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del ADMINISTRADOR para el código de los revisores de Apple y Google.
 *
 *   GET    → si hay uno vigente, y cuántas veces se usó (nunca el código)
 *   POST   → uno nuevo (sale UNA vez); el anterior deja de valer
 *   DELETE → revocarlo
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(ruta: string, metodo: 'GET' | 'POST'): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } }, { status: 403 });
  }
  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: metodo === 'POST' ? '{}' : undefined,
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}

export async function GET() {
  return proxy('/api/v1/admin/kioscos/codigo-revision', 'GET');
}

export async function POST() {
  return proxy('/api/v1/admin/kioscos/codigo-revision', 'POST');
}

export async function DELETE() {
  return proxy('/api/v1/admin/kioscos/codigo-revision/revocar', 'POST');
}
