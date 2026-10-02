import Link from 'next/link';

/**
 * «Resumen · Por producto», encima de los reportes del vendedor.
 *
 * Las pestañas conservan el periodo: si estás mirando «Este año» en el resumen
 * y pasas a productos, sigue siendo este año.
 */
export function PestanasReportes({ actual, periodo }: { actual: 'resumen' | 'productos'; periodo?: { desde: string; hasta: string } }) {
  const qs = periodo ? `?desde=${periodo.desde}&hasta=${periodo.hasta}` : '';
  const pestanas = [
    { clave: 'resumen', etiqueta: 'Resumen', href: `/reportes${qs}` },
    { clave: 'productos', etiqueta: 'Por producto', href: `/reportes/productos${qs}` },
  ] as const;
  return (
    <nav className="pestanas-reporte" aria-label="Tipo de reporte">
      {pestanas.map((p) => (
        <Link key={p.clave} href={p.href} className={p.clave === actual ? 'activa' : undefined} aria-current={p.clave === actual ? 'page' : undefined}>
          {p.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
