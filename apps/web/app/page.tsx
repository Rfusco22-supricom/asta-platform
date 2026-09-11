import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function Home() {
  const sesion = await getSession();
  redirect(sesion ? '/cartera' : '/login');
}
