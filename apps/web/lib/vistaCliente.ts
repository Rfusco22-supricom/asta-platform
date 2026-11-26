import { cookies } from 'next/headers';
import type { Session } from '@/lib/session';

/**
 * «Ver su panel»: el administrador, o el vendedor con un cliente de su cartera
 * (para hacerle la demostración), ve el panel de un cliente tal como lo ve él.
 *
 * El cliente elegido viaja en una cookie (`asta_vista_cliente`), y no en la
 * URL, para que el menú lleve de una pantalla suya a otra sin perderlo. Las
 * pantallas (/cuenta/…) son las mismas del cliente: con la cookie, y siendo
 * SUPERADMIN o VENDEDOR, piden sus datos a `/vista-cliente/:id` (solo lectura)
 * en vez de a `/account`. Que el cliente sea de su cartera lo comprueba el
 * middleware (`cliente.vista.ver`): la cookie no da acceso a nada por sí sola.
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

/** Quién puede mirar el panel de un cliente: el personal, no los clientes. */
export const puedeVerPaneles = (rol: string) => rol === 'SUPERADMIN' || rol === 'VENDEDOR';

/**
 * Para las pantallas del cliente: si quien mira es del personal (administrador
 * o vendedor), a qué cliente mira (o `null` si todavía no eligió). A un
 * cliente, nunca: lo suyo sale siempre de su token.
 */
export async function contextoCliente(sesion: Session): Promise<{ esPersonal: boolean; vista: VistaCliente | null }> {
  if (!puedeVerPaneles(sesion.usuario.role)) return { esPersonal: false, vista: null };
  const store = await cookies();
  return { esPersonal: true, vista: leer(store.get(COOKIE_VISTA)?.value) };
}

/** Para los puentes de `/api`: el cliente que mira el personal, o `null`. */
export async function clienteDeLaVista(sesion: Session): Promise<number | null> {
  return (await contextoCliente(sesion)).vista?.id ?? null;
}

/**
 * El título de un 403 en una pantalla del cliente. Mirando el panel de otro
 * («Ver su panel»), es que ese cliente no es de su cartera (el middleware lo
 * comprueba en cada lectura); si no, que la pantalla es de clientes.
 */
export function tituloSinPermiso(vista: VistaCliente | null): string {
  return vista ? 'Ese cliente no es de tu cartera' : 'Esta pantalla es para clientes';
}
