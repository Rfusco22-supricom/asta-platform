import Link from 'next/link';
import { CargandoEnlace } from './CargandoEnlace';

/**
 * «Resumen · Por producto · Por cliente», encima de «Mis ventas» del vendedor.
 *
 * Las pestañas conservan el periodo: si estás mirando «Este año» en el resumen
 * y pasas a productos, sigue siendo este año. «Por cliente» (`/asta`) es
 * histórico: no tiene periodo.
 */
export function PestanasReportes({ actual, periodo }: { actual: 'resumen' | 'productos' | 'clientes'; periodo?: { desde: string; hasta: string } }) {
  const qs = periodo ? `?desde=${periodo.desde}&hasta=${periodo.hasta}` : '';
  const pestanas = [
    { clave: 'resumen', etiqueta: 'Resumen', href: `/reportes${qs}` },
    { clave: 'productos', etiqueta: 'Por producto', href: `/reportes/productos${qs}` },
    { clave: 'clientes', etiqueta: 'Por cliente', href: '/asta' },
  ] as const;
  return (
    <nav className="pestanas-reporte" aria-label="Tipo de reporte">
      {pestanas.map((p) => (
        <Link key={p.clave} href={p.href} className={p.clave === actual ? 'activa' : undefined} aria-current={p.clave === actual ? 'page' : undefined}>
          {p.etiqueta}
          <CargandoEnlace />
        </Link>
      ))}
    </nav>
  );
}
