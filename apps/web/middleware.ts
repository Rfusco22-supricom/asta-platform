import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renueva el access token antes de que la página se renderice.
 *
 * ── Por qué aquí y no en el Server Component ─────────────────────────────────
 *
 * Un Server Component NO puede escribir cookies durante el render. Como el
 * access token dura 15 minutos, sin esto el usuario vería `/login` cada cuarto
 * de hora aunque su sesión siguiera viva 30 días.
 *
 * El middleware de Next sí puede, y corre antes del render. Es el único sitio
 * del framework donde este refresco encaja.
 */

const COOKIE_ACCESS = 'asta_at';
const COOKIE_REFRESH = 'asta_rt';
const COOKIE_USER = 'asta_u';

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function middleware(req: NextRequest) {
  const access = req.cookies.get(COOKIE_ACCESS)?.value;
  const refresh = req.cookies.get(COOKIE_REFRESH)?.value;

  // Con access válido no hay nada que hacer; sin refresh no hay nada que hacer.
  if (access || !refresh) return NextResponse.next();

  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });

    if (!res.ok) {
      // El refresh murió: puede ser caducidad normal, o que el middleware
      // detectara reuso y revocara todo. En ambos casos toca volver a entrar.
      const salida = NextResponse.next();
      for (const c of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_USER]) salida.cookies.delete(c);
      return salida;
    }

    const { data } = (await res.json()) as {
      data: {
        accessToken: string;
        expiraEn: number;
        usuario: { id: string; nombre: string; role: string };
      };
    };

    // El refresh ROTA: el middleware devuelve uno nuevo en su cookie y el
    // anterior queda revocado. Hay que quedarse con el nuevo o el siguiente
    // refresco se leería como reuso y cerraría todas las sesiones.
    const nuevoRefresh = res.headers
      .getSetCookie?.()
      ?.find((c) => c.startsWith(`${COOKIE_REFRESH}=`))
      ?.split(';')[0]
      ?.slice(COOKIE_REFRESH.length + 1);

    const salida = NextResponse.next();
    const base = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    };

    salida.cookies.set(COOKIE_ACCESS, data.accessToken, {
      ...base,
      maxAge: Math.max(30, data.expiraEn - 30),
    });
    salida.cookies.set(COOKIE_USER, JSON.stringify(data.usuario), {
      ...base,
      maxAge: 30 * 86_400,
    });
    if (nuevoRefresh) {
      salida.cookies.set(COOKIE_REFRESH, nuevoRefresh, { ...base, maxAge: 30 * 86_400 });
    }
    return salida;
  } catch {
    // El middleware no responde. No se borra la sesión: es un fallo de red, no
    // una sesión inválida, y echar al usuario por un corte de un segundo sería
    // desproporcionado. La página mostrará su propio error.
    return NextResponse.next();
  }
}

export const config = {
  // Solo en páginas. Los assets estáticos no necesitan sesión y pasar por aquí
  // les añadiría una llamada de red por archivo.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
};
