import { getRankingSede } from '@/lib/api';
import { nombrePeriodo } from '@/lib/meses';
import { Fallo, intentar, n } from './Tablero';

/**
 * Su puesto entre los vendedores de su sede (el spiff de ASTA): grande, el
 * suyo; debajo, todos, del primero al último, con el suyo marcado. Sin montos:
 * la API no los manda (`rankingSede.service`).
 *
 * El mes es el del filtro: el último del periodo elegido, como la meta del
 * Inicio del administrador. Por defecto, el que va en curso.
 */

const ORDINAL = (x: number) => `${n(x)}º`;

export async function PuestoSede({ token, rango }: { token: string; rango: { desde: string; hasta: string } }) {
  const delMes = { desde: `${rango.hasta.slice(0, 7)}-01`, hasta: rango.hasta };
  const r = await intentar(() => getRankingSede(token, delMes));
  if (!r) return <Fallo area="puesto" titulo="Tu puesto" />;
  if (!r.sede || r.posicion === null) return null;

  const mes = nombrePeriodo(delMes.desde, delMes.hasta);
  const podio = r.posicion <= 3;
  return (
    <section className="panel dash-puesto dash-ranking" aria-labelledby="puesto-titulo">
      <h2 id="puesto-titulo">Tu puesto en {r.sede}</h2>
      <div className={`puesto-destacado${podio ? ' puesto-podio' : ''}`}>
        <strong data-publico>{ORDINAL(r.posicion)}</strong>
        <span>
          de {n(r.total)} vendedores en ASTA · {mes}
          <small>{r.posicion === 1 ? '¡Vas primero! Que no te alcancen.' : podio ? 'Estás en el podio: a por el primer puesto.' : 'Cada venta de ASTA te sube en la lista.'}</small>
        </span>
      </div>
      <ol>
        {r.filas.map((f, i) => (
          <li key={i} className={f.tuyo ? 'puesto-tuyo' : undefined} aria-current={f.tuyo ? 'true' : undefined}>
            <span className="dash-pos" data-publico>
              {f.posicion}
            </span>
            <span className="dash-nombre">
              <span data-privado>{f.tuyo ? `${f.nombre} (tú)` : f.nombre}</span>
              {f.sinVentas && <small>todavía sin ventas de ASTA este mes</small>}
            </span>
          </li>
        ))}
      </ol>
      <p className="panel-nota">Por lo vendido de ASTA a tu cartera en el mes, sin IVA. No se enseñan montos de nadie.</p>
    </section>
  );
}
