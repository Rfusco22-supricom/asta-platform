import { NextResponse } from 'next/server';
import { getImpulsa, getRevisionCompatibilidades } from '@/lib/api';
import { getSession } from '@/lib/session';

/**
 * Los números del menú: cuánto espera en cada sección, por ruta.
 *
 *   · Vendedor → `/impulsa`: las sugerencias pendientes de «Pásale a ASTA».
 *   · Administrador → `/admin/compatibilidades`: las propuestas sin revisar.
 *
 * Lo pide el menú al cargar y cada pocos minutos (`components/NavLateral.tsx`).
 * Se guarda aquí 3 minutos por usuario: varias pestañas abiertas, o ir de una
 * pantalla a otra, no repiten la lectura. Las dos lecturas ya tienen su propia
 * caché en el middleware; esta evita además el viaje.
 *
 * `?fresco=1` se salta lo guardado: lo pide el menú justo después de que el
 * usuario cambie algo que mueve el número (marcar una sugerencia como hecha).
 *
 * Si algo falla se contesta con el contador vacío y no con un error: un número
 * que no llega no debe romper el menú.
 */

const DURACION_MS = 3 * 60_000;
const guardados = new Map<string, { hasta: number; contadores: Record<string, number> }>();

async function leer(rol: string, token: string): Promise<Record<string, number>> {
  if (rol === 'VENDEDOR') {
    const r = await getImpulsa(token);
    return { '/impulsa': r.meta.pendientes.sugerencias };
  }
  if (rol === 'SUPERADMIN') {
    const r = await getRevisionCompatibilidades(token, { estado: 'PROPUESTA' });
    return { '/admin/compatibilidades': r.meta.porEstado.PROPUESTA };
  }
  return {};
}

export async function GET(req: Request) {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });

  const clave = sesion.usuario.id;
  const ahora = Date.now();
  const fresco = new URL(req.url).searchParams.get('fresco') === '1';
  let guardado = guardados.get(clave);
  if (fresco || !guardado || guardado.hasta < ahora) {
    for (const [k, g] of guardados) if (g.hasta < ahora) guardados.delete(k);
    try {
      guardado = { hasta: ahora + DURACION_MS, contadores: await leer(sesion.usuario.role, sesion.accessToken) };
      guardados.set(clave, guardado);
    } catch {
      return NextResponse.json({ contadores: {} });
    }
  }
  return NextResponse.json({ contadores: guardado.contadores }, { headers: { 'Cache-Control': 'private, no-store' } });
}
