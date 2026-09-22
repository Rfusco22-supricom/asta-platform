import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Puente del ADMINISTRADOR para el tramo impresora → cartucho (#56).
 *
 *   GET   ?q=                  → impresoras que coinciden, para elegir
 *   POST  { filas, decision }   → revisar
 *   PUT   { marcaImpresora, modeloImpresora, codigoCartucho, … } → añadir (nace VALIDADA)
 *   PATCH { printerModelId, alias } → atar una búsqueda sin resultado como alias (#43)
 *
 * Como los demás puentes: los botones son de cliente y no tienen el token. El
 * vendedor tiene el suyo, `/api/compatibilidades/propuestas`, que llama a su propia
 * ruta del middleware.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

async function proxy(ruta: string, cuerpo: unknown, metodo: 'GET' | 'POST' = 'POST'): Promise<NextResponse> {
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
      headers: { Authorization: `Bearer ${sesion.accessToken}`, ...(metodo === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return proxy('/api/v1/admin/compatibilidades/impresoras/revision', await req.json().catch(() => null));
}

export async function PUT(req: Request) {
  return proxy('/api/v1/admin/compatibilidades/impresoras', await req.json().catch(() => null));
}

/** Impresoras que coinciden con `?q=`, para elegir a cuál atar un alias (#43). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  if (q.trim().length < 2) {
    return NextResponse.json({ error: { code: 'INVALID_QUERY', message: 'Escribe al menos dos caracteres.' } }, { status: 400 });
  }
  return proxy(`/api/v1/admin/compatibilidades/impresoras/buscar?q=${encodeURIComponent(q.trim())}`, null, 'GET');
}

/** Ata una búsqueda sin resultado a una impresora, como alias (#43). */
export async function PATCH(req: Request) {
  return proxy('/api/v1/admin/compatibilidades/alias', await req.json().catch(() => null));
}
