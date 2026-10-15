import { NextResponse } from 'next/server';
import { reenviar } from '../reenviar';

/** Dar acceso o cambiar el rol (PUT { rol }) y quitarlo (DELETE). */

const id = (v: string) => (/^\d{1,10}$/.test(v) ? v : null);
const invalido = () => NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Usuario no válido.' } }, { status: 400 });

export async function PUT(req: Request, { params }: { params: Promise<{ odooUserId: string }> }) {
  const odooUserId = id((await params).odooUserId);
  if (!odooUserId) return invalido();
  const body = (await req.json().catch(() => null)) as { rol?: unknown } | null;
  return reenviar(`/${odooUserId}`, { method: 'PUT', body: { rol: body?.rol } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ odooUserId: string }> }) {
  const odooUserId = id((await params).odooUserId);
  if (!odooUserId) return invalido();
  return reenviar(`/${odooUserId}`, { method: 'DELETE' });
}
