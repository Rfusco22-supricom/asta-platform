import { NextResponse } from 'next/server';
import { getClientesAdmin, getPortfolio } from '@/lib/api';
import { getSession } from '@/lib/session';

/**
 * Los clientes que se pueden buscar en la paleta ⌘K (`components/Paleta.tsx`).
 *
 * Solo lo que la paleta pinta —nombre, nivel y facturado—, no la fila entera de
 * `/portfolio`: la lista entera viaja una vez al abrir la paleta y se filtra en
 * el navegador mientras se escribe, sin una petición por tecla.
 *
 * El vendedor busca en su cartera; el administrador, en todos los clientes con
 * cuenta (`/admin/clientes`, sin facturado: ese dato no se calcula para 2.300).
 * Un cliente no busca a otros clientes: a él se le contesta con la lista vacía
 * y no con un error, y la paleta sigue sirviendo para secciones y acciones.
 */
export async function GET() {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  const cabeceras = { 'Cache-Control': 'private, no-store' };

  if (sesion.usuario.role === 'SUPERADMIN') {
    try {
      const filas = await getClientesAdmin(sesion.accessToken);
      return NextResponse.json({ clientes: filas.map((f) => ({ ...f, facturado: 0 })) }, { headers: cabeceras });
    } catch {
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo leer la lista de clientes.' } }, { status: 503 });
    }
  }
  if (sesion.usuario.role !== 'VENDEDOR') return NextResponse.json({ clientes: [] });

  try {
    const { filas } = await getPortfolio(sesion.accessToken);
    const clientes = filas.map((f) => ({ id: f.id, nombre: f.nombre, nivel: f.tierDerivado, facturado: f.totalFacturado }));
    return NextResponse.json({ clientes }, { headers: cabeceras });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo leer la cartera.' } }, { status: 503 });
  }
}
