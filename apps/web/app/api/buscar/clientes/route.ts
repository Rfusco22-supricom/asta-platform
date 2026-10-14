import { NextResponse } from 'next/server';
import { getPortfolio } from '@/lib/api';
import { getSession } from '@/lib/session';

/**
 * Los clientes de la cartera del vendedor, para la paleta ⌘K (`components/Paleta.tsx`).
 *
 * Solo lo que la paleta pinta —nombre, nivel y facturado—, no la fila entera de
 * `/portfolio`: la lista entera viaja una vez al abrir la paleta y se filtra en
 * el navegador mientras se escribe, sin una petición por tecla.
 *
 * Solo para vendedores: el administrador no tiene cartera (`cartera.ver`), y un
 * cliente no busca a otros clientes. A los demás se les contesta con la lista
 * vacía y no con un error: la paleta sigue sirviendo para secciones y acciones.
 */
export async function GET() {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  if (sesion.usuario.role !== 'VENDEDOR') return NextResponse.json({ clientes: [] });

  try {
    const { filas } = await getPortfolio(sesion.accessToken);
    const clientes = filas.map((f) => ({ id: f.id, nombre: f.nombre, nivel: f.tierDerivado, facturado: f.totalFacturado }));
    return NextResponse.json({ clientes }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo leer la cartera.' } }, { status: 503 });
  }
}
