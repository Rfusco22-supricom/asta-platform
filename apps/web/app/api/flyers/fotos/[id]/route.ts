import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { clienteDeLaVista } from '@/lib/vistaCliente';
import { rutaCliente } from '@/lib/api';

/**
 * Puente del CLIENTE para la foto de un producto ASTA en «Mis flyers». Va por
 * el panel para que la imagen sea del mismo origen y el `canvas` la pueda
 * exportar. Qué productos tienen foto lo decide el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  const { id } = await params;
  try {
    // El administrador en «Ver su panel»: por su ruta, que no pide ser cliente.
    const ruta = rutaCliente(`/flyers/fotos/${encodeURIComponent(id)}`, await clienteDeLaVista(sesion));
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json((await res.json().catch(() => null)) ?? {}, { status: res.status });
    return new NextResponse(res.body, {
      status: 200,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
