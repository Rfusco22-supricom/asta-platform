import { NextResponse } from 'next/server';
import { createApiKeyResponseSchema } from '@asta/shared-types';
import { z } from 'zod';
import { respuestaFiltrada } from '@/lib/filtrar';
import { getSession } from '@/lib/session';

/**
 * Puente para crear y revocar API keys (issue #28).
 *
 * Mismo patrón que el de notas y el de sesiones: los botones son componentes de
 * cliente y no pueden tener el token —vive en una cookie httpOnly—, así que el
 * navegador llama aquí y este servidor, que sí tiene la sesión, habla con el
 * middleware.
 *
 * El listado NO pasa por aquí: lo trae el Server Component directamente.
 *
 * ── Este puente no decide nada ───────────────────────────────────────────────
 *
 * Ni de quién es una key, ni qué scopes son válidos, ni cuántas puede tener.
 * Reenvía al middleware, que es el único que ve la tabla y el que comprueba
 * que una key no se pueda revocar desde la sesión de otro cliente. Lo único que
 * hace con la respuesta es quitarle lo que no esté en el contrato
 * (`lib/filtrar.ts`): eso no decide permisos, es la segunda barrera.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function alMiddleware(
  metodo: 'POST' | 'DELETE',
  ruta: string,
  cuerpo: unknown,
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo ?? {}),
      cache: 'no-store',
    });

    // Crear devuelve la key nueva; revocar, 204 sin cuerpo (lo deja pasar
    // `respuestaFiltrada`). Al navegador, solo lo del contrato.
    return respuestaFiltrada(res, z.object({ data: createApiKeyResponseSchema }));
  } catch {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } },
      { status: 503 },
    );
  }
}

/**
 * Crear.
 *
 * La respuesta lleva el token en claro y se devuelve tal cual al navegador: es
 * la única vez que existe. No se registra aquí ni se guarda en ningún sitio.
 */
export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => null);
  return alMiddleware('POST', '/api/v1/account/api-keys', cuerpo);
}

/** Revocar. */
export async function DELETE(req: Request) {
  const { id, reason } = (await req.json().catch(() => ({}))) as {
    id?: string;
    reason?: string;
  };

  if (!id) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Falta la key.' } },
      { status: 400 },
    );
  }

  // El id va tal cual: la comprobación de propiedad la hace el middleware
  // metiendo el `appUserId` dentro del `where`.
  return alMiddleware('DELETE', `/api/v1/account/api-keys/${encodeURIComponent(id)}`, { reason });
}
