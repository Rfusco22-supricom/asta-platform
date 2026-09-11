import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

/**
 * Entrada. Enruta por ROL.
 *
 * Un SUPERADMIN no tiene cartera —la matriz de permisos se la niega a
 * propósito— así que mandarle a /cartera le daría un 403 nada más entrar. El
 * sitio al que pertenece cada rol se decide aquí, en un solo lugar.
 */
export default async function Home() {
  const sesion = await getSession();
  if (!sesion) redirect('/login');
  redirect(sesion.usuario.role === 'SUPERADMIN' ? '/admin' : '/cartera');
}
