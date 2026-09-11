import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente para cerrar sesiones.
 *
 * Mismo patrón que el de notas: los botones son componentes de cliente y no
 * pueden tener el token. El navegador llama aquí y este servidor, que sí tiene
 * la sesión, habla con el middleware.
 *
 * Solo cierra. El listado lo hace el Server Component directamente, porque no
 * necesita pasar por el navegador para nada.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function cerrar(ruta: string): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } },
      { status: 401 },
    );
  }

  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
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

export async function DELETE(req: Request) {
  const { sesionId, todas } = (await req.json().catch(() => ({}))) as {
    sesionId?: string;
    todas?: boolean;
  };

  if (todas) return cerrar('/api/v1/auth/sessions');

  if (!sesionId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Falta la sesión.' } },
      { status: 400 },
    );
  }

  /*
   * El id se pasa tal cual y la comprobación de propiedad la hace el middleware
   * metiendo el `appUserId` dentro del `where`.
   *
   * Este puente NO puede decidir de quién es una sesión: solo conoce el token,
   * no la tabla. Filtrar aquí daría una falsa sensación de control y dejaría la
   * comprobación de verdad sin escribir.
   */
  return cerrar(`/api/v1/auth/sessions/${encodeURIComponent(sesionId)}`);
}
