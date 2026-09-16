import Link from 'next/link';

/**
 * Los dos tramos de una compatibilidad, en dos pestañas.
 *
 *   · Impresoras: a qué impresora le sirve un cartucho.
 *   · Productos:  qué producto de Odoo es ese cartucho.
 *
 * El kiosco necesita los dos validados para recomendar algo, así que las
 * pestañas van juntas en la misma sección y no en dos del menú.
 */
export function Pestanas({ actual }: { actual: 'impresoras' | 'productos' }) {
  return (
    <nav className="pestanas" aria-label="Tramo de la compatibilidad">
      <Link href="/admin/compatibilidades/impresoras" aria-current={actual === 'impresoras' ? 'page' : undefined}>
        Impresoras <span>qué cartucho le sirve a cada impresora</span>
      </Link>
      <Link href="/admin/compatibilidades" aria-current={actual === 'productos' ? 'page' : undefined}>
        Productos <span>qué producto de Odoo es cada cartucho</span>
      </Link>
    </nav>
  );
}
