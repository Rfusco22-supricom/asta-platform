import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { COOKIE_VISTA } from '@/lib/vistaCliente';

/**
 * Elegir (o dejar) el cliente cuyo panel mira el administrador en «Usuarios».
 *
 *   GET ?id=123&nombre=…&a=/cuenta/metricas → guarda el cliente y va a esa pantalla
 *   GET ?salir=1                            → lo olvida y vuelve al Inicio
 *
 * Solo el administrador; `a` solo puede ser una pantalla del cliente.
 */
export async function GET(req: Request) {
  const sesion = await getSession();
  const url = new URL(req.url);
  if (!sesion || sesion.usuario.role !== 'SUPERADMIN') return NextResponse.redirect(new URL('/', url));

  if (url.searchParams.get('salir')) {
    const res = NextResponse.redirect(new URL('/admin', url));
    res.cookies.delete(COOKIE_VISTA);
    return res;
  }

  const id = Number(url.searchParams.get('id'));
  const a = url.searchParams.get('a') ?? '/cuenta/metricas';
  const destino = /^\/cuenta\/[a-z-]+$/.test(a) ? a : '/cuenta/metricas';
  if (!Number.isInteger(id) || id <= 0) return NextResponse.redirect(new URL(destino, url));

  const res = NextResponse.redirect(new URL(destino, url));
  res.cookies.set(COOKIE_VISTA, JSON.stringify({ id, nombre: (url.searchParams.get('nombre') ?? '').slice(0, 120) }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 3600,
  });
  return res;
}
