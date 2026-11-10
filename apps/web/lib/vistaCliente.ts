import { cookies } from 'next/headers';
import type { Session } from '@/lib/session';

/**
 * «Ver su panel» del administrador: ver el panel de un cliente tal como lo ve él.
 *
 * El cliente elegido viaja en una cookie (`asta_vista_cliente`), y no en la
 * URL, para que el menú lleve de una pantalla suya a otra sin perderlo. Las
 * pantallas (/cuenta/…) son las mismas del cliente: con la cookie y siendo
 * SUPERADMIN, piden sus datos a `/admin/vista-cliente/:id` (solo lectura) en
 * vez de a `/account`.
 */

export const COOKIE_VISTA = 'asta_vista_cliente';

export interface VistaCliente {
  id: number;
  nombre: string;
}

function leer(valor: string | undefined): VistaCliente | null {
  if (!valor) return null;
  try {
    const v = JSON.parse(valor) as { id?: unknown; nombre?: unknown };
    const id = Number(v.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { id, nombre: typeof v.nombre === 'string' ? v.nombre.slice(0, 120) : `Cliente ${id}` };
  } catch {
    return null;
  }
}

/**
 * Para las pantallas del cliente: si quien mira es el administrador, a qué
 * cliente mira (o `null` si todavía no eligió). A un cliente, nunca: lo suyo
 * sale siempre de su token.
 */
export async function contextoCliente(sesion: Session): Promise<{ esAdmin: boolean; vista: VistaCliente | null }> {
  if (sesion.usuario.role !== 'SUPERADMIN') return { esAdmin: false, vista: null };
  const store = await cookies();
  return { esAdmin: true, vista: leer(store.get(COOKIE_VISTA)?.value) };
}

/** Para los puentes de `/api`: el cliente que mira el administrador, o `null`. */
export async function clienteDeLaVista(sesion: Session): Promise<number | null> {
  return (await contextoCliente(sesion)).vista?.id ?? null;
}
