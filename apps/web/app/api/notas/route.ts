import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente para crear y borrar notas.
 *
 * Igual que el de invitaciones: el formulario es un componente de cliente y no
 * puede tener el token de sesión. El navegador llama aquí, y este servidor —que
 * sí tiene la sesión— habla con el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(
  metodo: 'POST' | 'DELETE',
  ruta: string,
  cuerpo?: unknown,
): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } },
      { status: 401 },
    );
  }

  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${sesion.accessToken}`,
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
    });

    // 204 no trae cuerpo: intentar leerlo como JSON reventaría.
    if (res.status === 204) return new NextResponse(null, { status: 204 });

    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  const { partnerId, texto } = (await req.json().catch(() => ({}))) as {
    partnerId?: number;
    texto?: string;
  };
  if (!partnerId) {
    return NextResponse.json(
      { error: { code: 'INVALID_PARTNER_ID', message: 'Falta el cliente.' } },
      { status: 400 },
    );
  }
  return proxy('POST', `/api/v1/salesperson/clients/${partnerId}/notes`, { texto });
}

export async function DELETE(req: Request) {
  const { partnerId, notaId } = (await req.json().catch(() => ({}))) as {
    partnerId?: number;
    notaId?: string;
  };
  if (!partnerId || !notaId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Faltan datos.' } },
      { status: 400 },
    );
  }
  return proxy('DELETE', `/api/v1/salesperson/clients/${partnerId}/notes/${notaId}`);
}
