import { NextResponse } from 'next/server';
import { demoAplicacionRespuestaSchema } from '@asta/shared-types';
import { respuestaFiltrada } from '@/lib/filtrar';
import { getSession } from '@/lib/session';

/**
 * Puente del VENDEDOR para abrir una demostración de la aplicación ASTA
 * (`demoAplicacion.service`): devuelve el token firmado, hasta cuándo vale y de
 * qué sede son las existencias. Quién puede lo decide el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function POST() {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/salesperson/aplicacion/demo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
      cache: 'no-store',
    });
    return respuestaFiltrada(res, demoAplicacionRespuestaSchema);
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
