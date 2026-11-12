import { NextResponse, type NextRequest } from 'next/server';

/**
 * Puente de la aplicación ASTA web (`/aplicacion`) hacia la API de las tablets
 * del middleware (`/api/v1/kiosk`). Va por el panel para que la aplicación sea
 * del mismo origen (sin CORS) y para reenviar la IP de la tablet: el límite de
 * códigos equivocados de `/vincular` es por IP, y sin esto todas las tablets
 * contarían como el servidor del panel.
 *
 * No hay sesión del panel: quien autoriza es el token de la tablet
 * (`X-API-Key`), que el middleware comprueba. Solo pasan las rutas que usa la
 * aplicación.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

const PERMITIDAS: { metodo: 'GET' | 'POST'; patron: RegExp }[] = [
  { metodo: 'POST', patron: /^vincular$/ },
  { metodo: 'GET', patron: /^latido$/ },
  { metodo: 'GET', patron: /^recommender\/printers$/ },
  { metodo: 'GET', patron: /^recommender\/printers\/\d+\/compatible$/ },
  { metodo: 'POST', patron: /^recommender\/busquedas\/[\w-]+\/clic$/ },
];

const SIN_MIDDLEWARE = { error: { code: 'MIDDLEWARE_UNREACHABLE', message: 'El servidor no responde.' } };

async function reenviar(req: NextRequest, partes: string[], metodo: 'GET' | 'POST') {
  const ruta = partes.join('/');
  const noGuardar = { 'Cache-Control': 'no-store' };

  // El estado del servidor, para saber cuándo vuelve la red (sin token).
  if (ruta === 'salud' && metodo === 'GET') {
    try {
      const r = await fetch(`${MIDDLEWARE_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 503, headers: noGuardar });
    } catch {
      return NextResponse.json(SIN_MIDDLEWARE, { status: 502, headers: noGuardar });
    }
  }

  if (!PERMITIDAS.some((p) => p.metodo === metodo && p.patron.test(ruta))) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Ruta no disponible.' } }, { status: 404, headers: noGuardar });
  }

  const cabeceras: Record<string, string> = {
    // La IP de la tablet, como hace el login (el middleware solo se la cree al panel: TRUSTED_PROXIES).
    'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '',
  };
  for (const nombre of ['x-api-key', 'x-app-version', 'content-type', 'user-agent']) {
    const v = req.headers.get(nombre);
    if (v) cabeceras[nombre] = v;
  }

  try {
    const r = await fetch(`${MIDDLEWARE_URL}/api/v1/kiosk/${ruta}${req.nextUrl.search}`, {
      method: metodo,
      headers: cabeceras,
      body: metodo === 'POST' ? await req.text() : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    // Un 204 (el clic) no puede llevar cuerpo, ni vacío.
    const sinCuerpo = r.status === 204 || r.status === 304;
    return new NextResponse(sinCuerpo ? null : await r.text(), {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json', ...noGuardar },
    });
  } catch {
    return NextResponse.json(SIN_MIDDLEWARE, { status: 502, headers: noGuardar });
  }
}

type Contexto = { params: Promise<{ ruta: string[] }> };

export async function GET(req: NextRequest, { params }: Contexto) {
  return reenviar(req, (await params).ruta, 'GET');
}

export async function POST(req: NextRequest, { params }: Contexto) {
  return reenviar(req, (await params).ruta, 'POST');
}
