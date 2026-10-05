import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente para marcar una sugerencia de «Impulsa» (hecha, pospuesta, deshacer).
 *
 * Como el de notas: la lista es un componente de cliente y no tiene el token
 * de sesión. El navegador llama aquí y este servidor, que sí lo tiene, habla
 * con el middleware. Que el cliente sea del vendedor lo comprueba el
 * middleware (`impulsa.marcar`, ámbito partner-propio), no este puente.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  }

  const { partnerId, ...cuerpo } = (await req.json().catch(() => ({}))) as { partnerId?: unknown };
  if (typeof partnerId !== 'number' || !Number.isInteger(partnerId) || partnerId <= 0) {
    return NextResponse.json({ error: { code: 'INVALID_PARTNER_ID', message: 'Falta el cliente.' } }, { status: 400 });
  }

  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/salesperson/clients/${partnerId}/impulsa`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sesion.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
    });
    if (res.status === 204) return new NextResponse(null, { status: 204 });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
