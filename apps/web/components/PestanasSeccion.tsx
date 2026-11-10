import Link from 'next/link';

/**
 * Las pestañas de una sección que junta varias páginas: «Búsquedas y demanda»,
 * «Datos de Odoo» (errores y duplicados), «Personas y accesos» (equipo,
 * clientes e invitaciones). Cada pestaña es su propia página, así que los
 * enlaces de antes siguen sirviendo.
 */
export function PestanasSeccion({ etiqueta, pestanas, actual }: { etiqueta: string; pestanas: Array<{ href: string; titulo: string }>; actual: string }) {
  return (
    <nav className="pestanas-reporte" aria-label={etiqueta}>
      {pestanas.map((p) => (
        <Link key={p.href} href={p.href} prefetch={false} className={p.href === actual ? 'activa' : undefined} aria-current={p.href === actual ? 'page' : undefined}>
          {p.titulo}
        </Link>
      ))}
    </nav>
  );
}

/** «Búsquedas y demanda»: lo que se busca en la aplicación ASTA y lo que falta. */
export const PESTANAS_BUSQUEDAS = [
  { href: '/admin/recomendador', titulo: 'Búsquedas' },
  { href: '/admin/demanda', titulo: 'Demanda no cubierta' },
];

export const PESTANAS_ODOO = [
  { href: '/admin/calidad', titulo: 'Errores' },
  { href: '/admin/duplicados', titulo: 'Duplicados' },
];

export const PESTANAS_PERSONAS = [
  { href: '/admin/accesos', titulo: 'Equipo' },
  { href: '/admin/accesos?pestana=clientes', titulo: 'Clientes' },
  { href: '/admin/usuarios', titulo: 'Invitaciones' },
];
