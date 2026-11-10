import Link from 'next/link';
import type { SedeId } from '@asta/shared-types';
import { Proporcion } from '@/components/Reporte';
import { getReporteProductosEmpresa } from '@/lib/api';
import { Fallo, intentar, n } from './Tablero';

/**
 * Las listas con barra del Inicio y de Ventas: vendedores, clientes y
 * productos, del que más vende al que menos.
 */

export function Ranking<T>({
  area,
  titulo,
  nota,
  filas,
  nombre,
  valor,
  enlace,
  pie,
  privado,
}: {
  area: string;
  titulo: string;
  nota?: string;
  filas: T[];
  nombre: (f: T) => React.ReactNode;
  valor: (f: T) => number;
  enlace?: { href: string; texto: string };
  pie?: (f: T) => React.ReactNode;
  /** Los nombres son de clientes o vendedores: el modo presentación los tapa. */
  privado?: boolean;
}) {
  const maximo = Math.max(0, ...filas.map(valor));
  return (
    <section className={`panel dash-${area} dash-ranking`}>
      <h2>{titulo}</h2>
      {nota && <p className="panel-nota">{nota}</p>}
      {filas.length === 0 ? (
        <div className="empty">Sin ventas de ASTA en el periodo.</div>
      ) : (
        <ol>
          {filas.map((f, i) => (
            <li key={i}>
              <span className="dash-pos">{i + 1}</span>
              <span className="dash-nombre">
                <span data-privado={privado || undefined}>{nombre(f)}</span>
                {pie && <small>{pie(f)}</small>}
              </span>
              <Proporcion valor={valor(f)} maximo={maximo} />
            </li>
          ))}
        </ol>
      )}
      {enlace && (
        <Link className="dash-mas" href={enlace.href}>
          {enlace.texto} →
        </Link>
      )}
    </section>
  );
}

/** Los productos ASTA más vendidos del periodo. Está en Ventas: el Inicio ya no lo repite. */
export async function ProductosAsta({ token, rango, sede, cuantos = 8 }: { token: string; rango: { desde: string; hasta: string }; sede: SedeId | null; cuantos?: number }) {
  const r = await intentar(() => getReporteProductosEmpresa(token, rango, sede));
  if (!r) return <Fallo area="productos" titulo="Productos ASTA más vendidos" />;
  const productos = r.categorias
    .flatMap((c) => c.productos)
    .sort((a, b) => b.monto - a.monto)
    .slice(0, cuantos);
  return (
    <Ranking
      area="productos"
      titulo="Productos ASTA más vendidos"
      nota={`${n(r.totales.productos)} distintos en el periodo`}
      filas={productos}
      nombre={(p) => p.nombre.replace(/^ASTA\s+/i, '')}
      valor={(p) => p.monto}
      pie={(p) => `${n(Math.round(p.cantidad))} u. · ${n(p.clientes.length)} clientes`}
    />
  );
}
