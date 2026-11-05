import { getComparativaZona, esRedireccion } from '@/lib/api';
import { moneyEntero } from '@/lib/formato';
import { MIN_CLIENTES_ZONA, PARTE_ALTA_ZONA, porcentajeArriba, type GrupoZona, type MedidaZona } from '@asta/shared-types';

/**
 * «Tú frente a tu zona»: el cliente al lado de los de su estado y del país
 * (ver `comparativaZona.ts` en shared-types). Sin nombres ni cifras de nadie:
 * su puesto y las del grupo. Va en su propio `Suspense`: la primera vez lee
 * las compras de todos los clientes y tarda unos segundos.
 */

const n = (x: number) => x.toLocaleString('es-VE');
const ALTA = `${Math.round(PARTE_ALTA_ZONA * 100)} %`;

/** «en Carabobo», «en todo el país». */
const en = (g: GrupoZona) => `en ${g.nombre}`;

/** Dónde cae él en la fila de clientes, de 0 (el que menos) a 100 (el que más). */
function posicion(g: GrupoZona): number {
  if (g.puesto === null) return 0;
  return g.clientes <= 1 ? 100 : ((g.clientes - g.puesto) / (g.clientes - 1)) * 100;
}

function Celda({ m, valor }: { m: MedidaZona; valor: string }) {
  const clase = m.tuyo >= m.parteAlta && m.tuyo > 0 ? 'zona-bien' : m.tuyo < m.tipico ? 'zona-bajo' : undefined;
  return (
    <td className={clase} data-etiqueta="Tú">
      {valor}
    </td>
  );
}

function Medidas({ g }: { g: GrupoZona }) {
  const filas: Array<{ nombre: string; m: MedidaZona; f: (x: number) => string }> = [
    { nombre: 'Compras de ASTA', m: g.compras, f: moneyEntero },
    { nombre: 'Referencias distintas', m: g.referencias, f: n },
    { nombre: 'Meses con compra', m: g.meses, f: (x) => `${n(x)} de 12` },
  ];
  return (
    <div className="zona-tabla">
      <table>
        <thead>
          <tr>
            <th scope="col">12 meses</th>
            <th scope="col">Tú</th>
            <th scope="col">Cliente típico</th>
            <th scope="col">El {ALTA} que más</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ nombre, m, f }) => (
            <tr key={nombre}>
              <th scope="row">{nombre}</th>
              <Celda m={m} valor={f(m.tuyo)} />
              <td data-etiqueta="Cliente típico">{f(m.tipico)}</td>
              <td data-etiqueta={`El ${ALTA} que más`}>desde {f(m.parteAlta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lo que se le dice en una frase: dónde está y qué le falta. */
function Mensaje({ g }: { g: GrupoZona }) {
  if (g.puesto === null) {
    return (
      <p className="zona-mensaje">
        Todavía no has comprado ASTA en estos doce meses. El cliente típico {en(g)} compra {moneyEntero(g.compras.tipico)} al año en {n(g.referencias.tipico)}{' '}
        {g.referencias.tipico === 1 ? 'referencia' : 'referencias'}.
      </p>
    );
  }
  const falta = g.compras.parteAlta - g.compras.tuyo;
  return (
    <p className="zona-mensaje">
      {g.puesto === 1
        ? `Eres quien más compra ASTA ${en(g)}.`
        : falta <= 0
          ? `Estás entre los clientes que más compran ASTA ${en(g)}.`
          : `Te faltan ${moneyEntero(Math.ceil(falta))} en compras de ASTA para entrar en el ${ALTA} que más compra ${en(g)}.`}
    </p>
  );
}

function Fila({ g }: { g: GrupoZona }) {
  const x = posicion(g);
  return (
    <div className="zona-fila" role="img" aria-label={g.puesto === null ? `Sin compras de ASTA ${en(g)}` : `Puesto ${g.puesto} de ${g.clientes} ${en(g)}`}>
      <div className="zona-pista">
        <span className="zona-marca" style={{ left: '50%' }} title="Cliente típico" />
        <span className="zona-marca" style={{ left: `${(1 - PARTE_ALTA_ZONA) * 100}%` }} title={`El ${ALTA} que más compra`} />
        {g.puesto !== null && <span className="zona-tu" style={{ left: `${x}%` }} />}
      </div>
      <div className="zona-leyenda">
        <span>Menos compra</span>
        <span>Típico</span>
        <span>Más compra</span>
      </div>
    </div>
  );
}

export async function ComparativaZona({ token, cliente }: { token: string; cliente?: number | null }) {
  let c;
  try {
    c = await getComparativaZona(token, cliente);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    // Sin comparativa, las métricas siguen: es un extra, no un dato suyo.
    return null;
  }
  const g = c.zona ?? c.pais;
  if (!g) return null;
  const otro = c.zona ? c.pais : null;

  return (
    <section className="panel zona">
      <h2>{c.zona ? 'Tú frente a tu zona' : 'Tú frente a los demás clientes'}</h2>
      <p className="panel-nota">
        Comparado con los {n(g.clientes)} clientes que compraron ASTA {en(g)} en los últimos doce meses.
        {!c.zona &&
          (c.estado
            ? ` En ${c.estado} hay menos de ${MIN_CLIENTES_ZONA} clientes con ASTA: compararte con ellos diría quiénes son, así que va con todo el país.`
            : ' Tu ficha no tiene estado: va con todo el país.')}{' '}
        Es anónimo: nadie ve tus cifras y tú no ves las de nadie.
      </p>

      <div className="zona-destacado">
        {g.puesto !== null && (
          <div className="zona-top">
            <small>Top</small>
            <b>{porcentajeArriba(g.puesto, g.clientes)} %</b>
          </div>
        )}
        <div className="zona-texto">
          <Mensaje g={g} />
          <span className="stat-sub">
            {g.puesto !== null && `Puesto ${n(g.puesto)} de ${n(g.clientes)} ${en(g)}.`}
            {otro?.puesto != null && ` En todo el país, puesto ${n(otro.puesto)} de ${n(otro.clientes)} (top ${porcentajeArriba(otro.puesto, otro.clientes)} %).`}
          </span>
        </div>
      </div>

      <Fila g={g} />
      <Medidas g={g} />
      <p className="panel-nota zona-pie">
        «Cliente típico»: la mitad de los clientes {en(g)} está por encima y la mitad por debajo.
      </p>
    </section>
  );
}
