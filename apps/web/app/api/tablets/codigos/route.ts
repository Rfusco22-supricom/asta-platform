import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del CLIENTE para los códigos con los que vincula una tablet.
 *
 *   POST { nombre, tienda? } → el código (sale UNA vez)
 *   GET  ?id=…               → si la tablet ya lo usó
 *
 * Como `../route.ts`: lo que el cliente puede hacer lo decide el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(ruta: string, metodo: 'GET' | 'POST', cuerpo?: unknown): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: metodo === 'POST' ? JSON.stringify(cuerpo ?? {}) : undefined,
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
  return proxy('/api/v1/account/tablets/codigos', 'POST', await req.json().catch(() => null));
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!idValido(id)) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Falta el código.' } }, { status: 400 });
  return proxy(`/api/v1/account/tablets/codigos/${id}`, 'GET');
}
