import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del CLIENTE para descargar el PDF de una de sus facturas. Pasa los
 * bytes tal cual; de quién es la factura lo decide el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  const { id } = await params;
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/account/facturas/${encodeURIComponent(id)}/pdf`, {
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return NextResponse.json(body ?? {}, { status: res.status });
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': res.headers.get('content-disposition') ?? `attachment; filename="factura-${id}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
