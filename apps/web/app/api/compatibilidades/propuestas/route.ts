import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del VENDEDOR para proponer compatibilidades (#56).
 *
 * Llama a `/salesperson/compatibilidades`, que solo sabe crear PROPUESTAS. No
 * reenvía a la ruta del administrador aunque quien llame lo sea: cada rol tiene su
 * puente, igual que su ruta.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function PUT(req: Request) {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  }
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/salesperson/compatibilidades`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(await req.json().catch(() => null)),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
