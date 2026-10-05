import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del ADMINISTRADOR para «Impresora | Tóners compatibles».
 *
 *   GET ?q=                                         → tóners que coinciden, para el selector
 *   PUT { printerModelId, vistos, compatibles, nuevos } → deja la impresora con esos tóners
 *
 * Como los demás puentes: el selector es de cliente y no tiene el token.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(ruta: string, metodo: 'GET' | 'PUT', cuerpo?: unknown): Promise<NextResponse> {
  const sesion = await getSession();
  if (!sesion) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  }
  if (sesion.usuario.role !== 'SUPERADMIN') {
    return NextResponse.json({ error: { code: 'ROLE_NOT_ALLOWED', message: 'Solo administradores.' } }, { status: 403 });
  }
  try {
    const res = await fetch(`${MIDDLEWARE_URL}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${sesion.accessToken}`, ...(metodo === 'PUT' ? { 'Content-Type': 'application/json' } : {}) },
      body: metodo === 'PUT' ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ data: [] });
  return proxy(`/api/v1/admin/compatibilidades/cartuchos?q=${encodeURIComponent(q)}`, 'GET');
}

export async function PUT(req: Request) {
  const cuerpo = (await req.json().catch(() => null)) as { printerModelId?: unknown } | null;
  const id = Number(cuerpo?.printerModelId);
  if (!cuerpo || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Falta la impresora.' } }, { status: 400 });
  }
  const { printerModelId: _id, ...resto } = cuerpo;
  return proxy(`/api/v1/admin/compatibilidades/por-impresora/${id}`, 'PUT', resto);
}
