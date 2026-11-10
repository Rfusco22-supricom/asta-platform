import { beneficiosDe, beneficiosNuevos, reglaDe, subir, type ClaveCategoria } from '@asta/shared-types';
import { InsigniaCategoria } from '@/components/Categorias';
import { moneyEntero } from '@/lib/formato';

/**
 * Los beneficios del programa ASTA para un nivel: lo que ya tiene y lo que
 * suma si sube. Lo ve el cliente en «Mis métricas» y el vendedor en la ficha,
 * para saber qué le toca y qué ofrecerle para que suba. La lista vive en
 * `@asta/shared-types` (`beneficiosAsta.ts`).
 *
 * Diamante está bloqueado (`NIVEL_MAXIMO`): sale con candado y «Próximamente»,
 * sin beneficios ni cuota. Los beneficios son los mismos para todo el nivel:
 * el modo presentación los deja ver.
 */

type Para = 'cliente' | 'vendedor';

function Candado() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </svg>
  );
}

function Lista({ nivel, nuevos }: { nivel: ClaveCategoria; nuevos?: boolean }) {
  const lista = nuevos ? beneficiosNuevos(nivel) : beneficiosDe(nivel);
  return (
    <ul className={`benef-lista${nuevos ? ' nuevos' : ''}`} data-publico>
      {lista.map((b) => (
        <li key={b.clave}>
          <strong>{b.titulo}</strong>
          <span className="stat-sub">{b.detalle}</span>
        </li>
      ))}
    </ul>
  );
}

export function Beneficios({ nivel, para }: { nivel: ClaveCategoria; para: Para }) {
  const cliente = para === 'cliente';
  const arriba = subir(nivel);
  const tiene = beneficiosDe(nivel).length > 0;

  return (
    <section className="panel benef" aria-labelledby="benef-titulo">
      <h2 id="benef-titulo">{cliente ? 'Tus beneficios' : 'Beneficios del cliente'}</h2>
      <div className="benef-columnas">
        <div className="benef-col">
          <h3 className="prog-sub">
            {cliente ? 'Los que tienes' : 'Los que tiene'} · {reglaDe(nivel).nombre}
          </h3>
          {tiene ? (
            <Lista nivel={nivel} />
          ) : (
            <p className="stat-sub benef-vacio">
              {cliente ? 'Todavía ninguno: empiezan al llegar a Bronce.' : 'Todavía ninguno: empiezan en Bronce.'}
            </p>
          )}
        </div>

        <div className="benef-col">
          {arriba !== nivel ? (
            <>
              <h3 className="prog-sub benef-arriba">
                {cliente ? 'Si subes a' : 'Si sube a'} <InsigniaCategoria categoria={arriba} /> {cliente ? 'sumas' : 'suma'}
              </h3>
              <Lista nivel={arriba} nuevos />
            </>
          ) : (
            <p className="stat-sub benef-vacio">
              {cliente ? 'Ya tienes todos los beneficios del programa.' : 'Ya tiene todos los beneficios del programa.'}
            </p>
          )}
          <p className="benef-bloqueado">
            <Candado />
            <span>
              <strong>Diamante</strong> · Próximamente
            </span>
          </p>
        </div>
      </div>
      {!cliente && arriba !== nivel && <p className="stat-sub benef-pie">Para subir, en el trimestre tiene que cumplir la cuota mensual, la del trimestre y reportar el sell-out.</p>}
    </section>
  );
}

/**
 * Los beneficios de TODOS los niveles, como referencia para Supricom (en
 * «Niveles y trimestre» del administrador y «Programa ASTA» del vendedor):
 * cada nivel con su cuota y lo que estrena; los de abajo se conservan.
 * Diamante, bloqueado.
 */
export function BeneficiosPorNivel() {
  const niveles = (['BRONCE', 'PLATA', 'ORO'] as const).map((clave, i, todos) => ({
    clave,
    regla: reglaDe(clave),
    nuevos: beneficiosNuevos(clave),
    conserva: i > 0 ? reglaDe(todos[i - 1]!).nombre : null,
  }));
  return (
    <section className="panel benef-niveles" aria-labelledby="benef-niveles-titulo">
      <h2 id="benef-niveles-titulo">Beneficios por nivel</h2>
      <p className="panel-nota">Lo que gana el cliente en cada nivel. Cada uno conserva los de los niveles de abajo; Cliente general no tiene beneficios.</p>
      <div className="benef-niveles-rejilla" data-publico>
        {niveles.map((nv) => (
          <div key={nv.clave} className="benef-nivel">
            <div className="benef-nivel-cabeza">
              <InsigniaCategoria categoria={nv.clave} />
              <span className="stat-sub">desde {moneyEntero(nv.regla.minimoMensual)} al mes</span>
            </div>
            <ul className="benef-lista">
              {nv.nuevos.map((b) => (
                <li key={b.clave}>
                  <strong>{b.titulo}</strong>
                  <span className="stat-sub">{b.detalle}</span>
                </li>
              ))}
            </ul>
            {nv.conserva && <span className="stat-sub">+ los de {nv.conserva}</span>}
          </div>
        ))}
        <div className="benef-nivel benef-nivel-bloqueado">
          <div className="benef-nivel-cabeza">
            <InsigniaCategoria categoria="DIAMANTE" />
          </div>
          <p className="benef-bloqueado">
            <Candado />
            <span>Próximamente</span>
          </p>
          <span className="stat-sub">Bloqueado: Oro es hoy el nivel más alto.</span>
        </div>
      </div>
    </section>
  );
}
