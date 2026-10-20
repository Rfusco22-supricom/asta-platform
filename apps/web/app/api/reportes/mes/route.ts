import { NextResponse } from 'next/server';
import { nombreSede, sedeDe, type ReporteProductos } from '@asta/shared-types';
import { getSession } from '@/lib/session';
import {
  ApiError,
  esRedireccion,
  getReporteCartera,
  getReporteEmpresa,
  getReporteProductos,
  getReporteProductosEmpresa,
} from '@/lib/api';
import { rangoDeMes } from '@/lib/meses';

/**
 * El detalle de un mes del gráfico «mes a mes» (Reportes e Inicio).
 *
 *   GET /api/reportes/mes?periodo=2026-02[&sede=9]
 *
 * Es el mismo reporte de siempre, pedido para un solo mes: el administrador ve
 * toda la empresa (o la sede elegida) y el vendedor, su cartera. Cada uno por
 * su ruta y con su permiso, como en la página: aquí no se decide qué puede ver
 * nadie, solo a qué ruta del middleware se pregunta.
 *
 * Como los demás puentes: el gráfico es de cliente y no tiene el token.
 */

/** Primer mes con ASTA en Odoo; lo anterior es Smartbit (`smartbit.service.ts`). */
const PRIMER_MES_ODOO = '2026-04';

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** Los productos ASTA más vendidos del mes, de más a menos. */
function topAsta(r: ReporteProductos) {
  return r.categorias
    .flatMap((c) => c.productos)
    .filter((p) => p.esAsta && p.monto > 0)
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 5)
    .map((p) => ({ productId: p.productId, sku: p.sku, nombre: p.nombre, cantidad: p.cantidad, monto: p.monto }));
}

export async function GET(req: Request) {
  const sesion = await getSession();
  if (!sesion) return error(401, 'UNAUTHENTICATED', 'Tu sesión caducó. Vuelve a entrar.');

  const url = new URL(req.url);
  const periodo = url.searchParams.get('periodo') ?? '';
  const rango = rangoDeMes(periodo);
  if (!rango) return error(400, 'VALIDATION_ERROR', 'El mes no es válido.');

  const rol = sesion.usuario.role;
  if (rol !== 'SUPERADMIN' && rol !== 'VENDEDOR') return error(403, 'ROLE_NOT_ALLOWED', 'Esta información es para el equipo de ventas.');
  const empresa = rol === 'SUPERADMIN';

  // La sede solo existe en la vista de la empresa.
  const sede = empresa ? sedeDe(url.searchParams.get('sede')) : null;
  if (sede === undefined) return error(400, 'VALIDATION_ERROR', 'La sede no es válida.');

  const token = sesion.accessToken;
  try {
    const [reporte, productos] = await Promise.all([
      empresa ? getReporteEmpresa(token, rango, sede) : getReporteCartera(token, rango),
      // Los productos son un extra: si fallan, el detalle sale igual sin ellos.
      (empresa ? getReporteProductosEmpresa(token, rango, sede) : getReporteProductos(token, rango)).catch((e: unknown) => {
        if (esRedireccion(e)) throw e;
        return null;
      }),
    ]);

    const base = empresa ? '/admin/reportes' : '/reportes';
    const qs = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
    if (sede !== null) qs.set('sede', String(sede));

    return NextResponse.json(
      {
        data: {
          periodo,
          vista: empresa ? 'empresa' : 'cartera',
          ambito: empresa ? nombreSede(sede) : 'Tu cartera',
          fuente: periodo < PRIMER_MES_ODOO ? 'Smartbit' : 'Odoo',
          totales: reporte.totales,
          topClientes: reporte.topClientes.slice(0, 5),
          porVendedor: reporte.porVendedor ? reporte.porVendedor.filter((v) => v.facturado > 0).slice(0, 5) : null,
          productos: productos ? topAsta(productos) : null,
          enlace: `${base}?${qs}`,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    // Sesión muerta: `request` redirige al login, y eso aquí no sirve de nada.
    if (esRedireccion(e)) return error(401, 'UNAUTHENTICATED', 'Tu sesión caducó. Vuelve a entrar.');
    if (e instanceof ApiError) return error(e.status, e.code, e.message);
    return error(502, 'UPSTREAM_ERROR', 'No se pudo leer el mes. Vuelve a intentarlo.');
  }
}
