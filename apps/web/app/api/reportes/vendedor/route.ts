import { NextResponse } from 'next/server';
import { sedeDe } from '@asta/shared-types';
import { getSession } from '@/lib/session';
import { ApiError, esRedireccion, getFacturasVendedor } from '@/lib/api';

/**
 * Las facturas con ASTA de un vendedor, para la ventana que se abre al pulsar
 * su fila en el ranking del Inicio del administrador.
 *
 *   GET /api/reportes/vendedor?odooUserId=380&desde=2026-01-01&hasta=2026-11-30[&sede=9]
 *
 * Solo el administrador: es lo de toda la empresa. Como los demás puentes, la
 * ventana es de cliente y no tiene el token.
 */

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'private, no-store' } });

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const sesion = await getSession();
  if (!sesion) return error(401, 'UNAUTHENTICATED', 'Tu sesión caducó. Vuelve a entrar.');
  if (sesion.usuario.role !== 'SUPERADMIN') return error(403, 'ROLE_NOT_ALLOWED', 'Esta información es de administración.');

  const url = new URL(req.url);
  const odooUserId = Number(url.searchParams.get('odooUserId'));
  const desde = url.searchParams.get('desde') ?? '';
  const hasta = url.searchParams.get('hasta') ?? '';
  if (!Number.isInteger(odooUserId) || odooUserId <= 0 || !FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) {
    return error(400, 'VALIDATION_ERROR', 'El vendedor o el periodo no son válidos.');
  }
  const sede = sedeDe(url.searchParams.get('sede'));
  if (sede === undefined) return error(400, 'VALIDATION_ERROR', 'La sede no es válida.');

  try {
    const data = await getFacturasVendedor(sesion.accessToken, odooUserId, { desde, hasta }, sede);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    if (esRedireccion(e)) return error(401, 'UNAUTHENTICATED', 'Tu sesión caducó. Vuelve a entrar.');
    if (e instanceof ApiError) return error(e.status, e.code, e.message);
    return error(502, 'UPSTREAM_ERROR', 'No se pudieron leer las facturas. Vuelve a intentarlo.');
  }
}
