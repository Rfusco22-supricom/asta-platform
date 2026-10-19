import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { destinoPara } from '@/lib/navegacion';

/**
 * Todo `/admin` es del administrador.
 *
 * El middleware ya responde 403 a cualquier otro rol, así que nadie ve datos que
 * no le tocan. Pero la página se pintaba igual: un vendedor que escribía
 * `/admin` veía el Inicio de administración vacío, con sus filtros y sin una
 * sola cifra ni un aviso. Mejor llevarlo a lo suyo, como hace `/inicio` con
 * quien no es vendedor.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const sesion = await requireSession();
  if (sesion.usuario.role !== 'SUPERADMIN') redirect(destinoPara(sesion.usuario.role));
  return children;
}
