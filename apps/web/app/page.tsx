import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { destinoPara } from '@/lib/rutas';

/**
 * Entrada. Enruta por ROL.
 *
 * La regla vive en `lib/rutas.ts`, no aquí: esta decisión se toma también al
 * terminar el login, y tenerla escrita dos veces ya causó que un cliente
 * aterrizara en un 403 en su primera pantalla.
 */
export default async function Home() {
  const sesion = await getSession();
  if (!sesion) redirect('/login');
  redirect(destinoPara(sesion.usuario.role));
}
