import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del CLIENTE para subir su sell-out.
 *
 *   POST { mes, tipo, nombre, archivo, guardar? } → sin `guardar`, solo
 *        comprueba el archivo; con `guardar: true`, lo guarda si no tiene errores.
 *
 * No decide nada: el archivo lo lee y lo comprueba el middleware, que sabe de
 * quién es la sesión.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  const { guardar, ...cuerpo } = ((await req.json().catch(() => null)) ?? {}) as { guardar?: unknown } & Record<string, unknown>;
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/account/sellout${guardar === true ? '' : '/comprobar'}`, {
      method: 'POST',
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
