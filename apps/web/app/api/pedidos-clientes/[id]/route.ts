import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del PERSONAL para atender un pedido de un cliente.
 *
 *   PATCH { estado: 'EN_ODOO', folioOdoo? } | { estado: 'DESCARTADO', motivo }
 *
 * El administrador va a la ruta de administración y el vendedor a la suya; qué
 * pedidos puede marcar cada uno lo decide el middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  const { id } = await params;
  const base = sesion.usuario.role === 'SUPERADMIN' ? 'admin' : 'salesperson';
  const cuerpo = (await req.json().catch(() => null)) ?? {};
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/${base}/pedidos-clientes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
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
