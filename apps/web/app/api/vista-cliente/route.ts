import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { COOKIE_VISTA, puedeVerPaneles } from '@/lib/vistaCliente';
import { destinoPara } from '@/lib/navegacion';

/**
 * Elegir (o dejar) el cliente cuyo panel mira el personal en «Ver su panel»: el
 * administrador, o el vendedor con un cliente de su cartera.
 *
 *   GET ?id=123&nombre=…&a=/cuenta/metricas → guarda el cliente y va a esa pantalla
 *   GET ?salir=1                            → lo olvida y vuelve al Inicio
 *
 * Solo el personal; `a` solo puede ser una pantalla del cliente. La cookie no
 * abre nada por sí sola: el middleware comprueba cada lectura
 * (`cliente.vista.ver`), y a un vendedor solo le deja los de su cartera.
 *
 * Las redirecciones van con la ruta sola (`Location: /cuenta/…`), sin dominio:
 * detrás del proxy de EasyPanel, `req.url` es la dirección interna del
 * contenedor (`http://0.0.0.0:3000`), y redirigir a ella deja al navegador en
 * una página que no puede abrir. El navegador completa la ruta con el dominio
 * en el que ya está.
 */
function irA(ruta: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: ruta } });
}

export async function GET(req: Request) {
  const sesion = await getSession();
  const url = new URL(req.url);
  if (!sesion || !puedeVerPaneles(sesion.usuario.role)) return irA('/');

  if (url.searchParams.get('salir')) {
    const res = irA(destinoPara(sesion.usuario.role));
    res.cookies.delete(COOKIE_VISTA);
    return res;
  }

  const id = Number(url.searchParams.get('id'));
  const a = url.searchParams.get('a') ?? '/cuenta/metricas';
  const destino = /^\/cuenta\/[a-z-]+$/.test(a) ? a : '/cuenta/metricas';
  if (!Number.isInteger(id) || id <= 0) return irA(destino);

  const res = irA(destino);
  res.cookies.set(COOKIE_VISTA, JSON.stringify({ id, nombre: (url.searchParams.get('nombre') ?? '').slice(0, 120) }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 3600,
  });
  return res;
}
