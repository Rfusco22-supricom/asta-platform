import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del CLIENTE para «Lo que te vendimos».
 *
 *   GET  ?mes=AAAA-MM            → lo que nos compró, lo marcado y lo que le queda
 *   POST { mes, productId, cantidad } → cuántas vendió de ese producto en el mes
 *
 * No decide nada: de quién es y qué se puede marcar lo decide el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function reenviar(ruta: string, init: RequestInit): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/account/sellout/marcar${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}

export async function GET(req: Request) {
  const mes = new URL(req.url).searchParams.get('mes');
  return reenviar(mes ? `?mes=${encodeURIComponent(mes)}` : '', { method: 'GET' });
}

export async function POST(req: Request) {
  const cuerpo = (await req.json().catch(() => null)) ?? {};
  return reenviar('', { method: 'POST', body: JSON.stringify(cuerpo) });
}
