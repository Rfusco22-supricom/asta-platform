import { EXCEDENTE, TOKENS, VARIEDAD, bajar, nombreTrimestre, reglaDe, subir, type EvaluacionTrimestre, type MetricasCliente } from '@asta/shared-types';
import { InsigniaCategoria } from '@/components/Categorias';
import { etiquetaMes } from '@/lib/meses';
import { moneyEntero } from '@/lib/formato';

/**
 * El programa de ASTA, visto por el cliente: su nivel, sus tokens, y cómo va
 * en el trimestre con lo que mueve el nivel (los tres obligatorios) y lo que
 * solo da tokens (los extras). Reglas en `@asta/shared-types` (`programaAsta.ts`).
 *
 * Lo que aún no se sabe sale «pendiente», no «no cumplido»: a mitad de mes
 * nadie ha comprado el mínimo todavía.
 */

const n = (x: number) => x.toLocaleString('es-VE');

type Estado = boolean | null;

function Marca({ estado }: { estado: Estado }) {
  if (estado === true) return <span className="prog-marca ok" aria-label="Cumplido">✓</span>;
  if (estado === false) return <span className="prog-marca no" aria-label="No cumplido">✕</span>;
  return <span className="prog-marca pendiente" aria-label="Pendiente">·</span>;
}

/** «nov 26» → el día que vence su sell-out: «10 dic». */
function limite(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return `10 ${etiquetaMes(new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7)).split(' ')[0]}`;
}

/** El mes que empieza el trimestre siguiente: cuando se cierra. */
function cierre(trimestre: string): string {
  const [a, q] = trimestre.split('-Q').map(Number) as [number, number];
  return q === 4 ? `enero de ${a + 1}` : ['abril', 'julio', 'octubre'][q - 1]!;
}

/** Qué pasará con su nivel, dicho en una frase. */
function Veredicto({ e }: { e: EvaluacionTrimestre }) {
  const { mensual, trimestral, sellout } = e.obligatorios;
  const arriba = subir(e.nivel);
  const abajo = bajar(e.nivel);
  const cuando = cierre(e.trimestre);
  if (mensual === true && trimestral === true && sellout === true) {
    return arriba === e.nivel ? (
      <p className="prog-veredicto ok">Cumples los tres: en {cuando} mantienes {reglaDe(e.nivel).nombre} y sumas tokens.</p>
    ) : (
      <p className="prog-veredicto ok">
        Cumples los tres: en {cuando} subes a <InsigniaCategoria categoria={arriba} />.
      </p>
    );
  }
  if (mensual === false || trimestral === false || sellout === false) {
    return abajo === e.nivel ? (
      <p className="prog-veredicto">Este trimestre ya no se cumple todo: en {cuando} sigues en {reglaDe(e.nivel).nombre}.</p>
    ) : (
      <p className="prog-veredicto no">
        Este trimestre ya no se cumple todo: en {cuando} bajas a <InsigniaCategoria categoria={abajo} />.
      </p>
    );
  }
  return (
    <p className="prog-veredicto">
      {arriba === e.nivel ? (
        <>Si cumples los tres, en {cuando} mantienes {reglaDe(e.nivel).nombre}.</>
      ) : (
        <>
          Si cumples los tres, en {cuando} subes a <InsigniaCategoria categoria={arriba} />.
        </>
      )}{' '}
      {abajo !== e.nivel && <>Si falla uno, bajas a {reglaDe(abajo).nombre}.</>}
    </p>
  );
}

function Obligatorio({ titulo, estado, regla, tokens, children }: { titulo: string; estado: Estado; regla: string; tokens: number; children: React.ReactNode }) {
  return (
    <li className="prog-fila">
      <Marca estado={estado} />
      <div className="prog-texto">
        <strong>{titulo}</strong>
        <span className="stat-sub">{regla}</span>
        {children}
      </div>
      <span className="prog-tokens-fila">+{tokens}</span>
    </li>
  );
}

export function ProgramaCliente({ programa }: { programa: MetricasCliente['programa'] }) {
  if (!programa) {
    return (
      <section className="panel">
        <h2>Tu nivel ASTA</h2>
        <div className="empty">No se pudo leer ahora.</div>
      </section>
    );
  }
  const { evaluacion: e, saldoTokens } = programa;
  const general = e.nivel === 'GENERAL';
  const minimoRef = Math.ceil(e.referencias.total * VARIEDAD);

  return (
    <section className="panel prog" aria-labelledby="prog-titulo">
      <div className="prog-cabeza">
        <div className="prog-nivel">
          <h2 id="prog-titulo">Tu nivel ASTA · {nombreTrimestre(e.trimestre)}</h2>
          <InsigniaCategoria categoria={e.nivel} />
        </div>
        <div className="prog-saldo">
          <b>{n(saldoTokens)}</b>
          <span>tokens acumulados</span>
        </div>
      </div>
      <Veredicto e={e} />

      <h3 className="prog-sub">Para subir de nivel{general ? ' (contra las cuotas de Bronce)' : ''}</h3>
      <ol className="prog-lista">
        <Obligatorio titulo="Cuota mensual" tokens={TOKENS.mensual} estado={e.obligatorios.mensual} regla={`Al menos ${moneyEntero(e.cuotaMensual)} cada mes`}>
          <span className="prog-meses">
            {e.meses.map((m) => (
              <span key={m.mes} className={`prog-mes ${m.cumpleMinimo === true ? 'ok' : m.cumpleMinimo === false ? 'no' : ''}`}>
                {etiquetaMes(m.mes)} · {moneyEntero(m.compra)}
              </span>
            ))}
          </span>
        </Obligatorio>
        <Obligatorio titulo="Cuota del trimestre" tokens={TOKENS.trimestral} estado={e.obligatorios.trimestral} regla={`Al menos ${moneyEntero(e.cuotaTrimestral)} en los tres meses`}>
          <span className="prog-avance">
            <span className="proporcion-barra" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (e.compraTrimestre / e.cuotaTrimestral) * 100)}%` }} />
            </span>
            {moneyEntero(e.compraTrimestre)} de {moneyEntero(e.cuotaTrimestral)}
          </span>
        </Obligatorio>
        <Obligatorio titulo="Sell-out" tokens={TOKENS.sellout} estado={e.obligatorios.sellout} regla="Repórtalo cada mes en «Mi sell-out», hasta el día 10 del siguiente">
          <span className="prog-meses">
            {e.meses.map((m) => (
              <span key={m.mes} className={`prog-mes ${m.sellout === true ? 'ok' : m.sellout === false ? 'no' : ''}`}>
                {etiquetaMes(m.mes)} · {m.sellout === true ? 'reportado' : m.sellout === false ? 'sin reportar' : `hasta el ${limite(m.mes)}`}
              </span>
            ))}
          </span>
        </Obligatorio>
      </ol>

      <h3 className="prog-sub">Tokens extra · no cambian el nivel</h3>
      <ul className="prog-extras">
        <li>
          <Marca estado={e.extras.excedente} />
          <span>
            <strong>Excedente</strong>
            <span className="stat-sub">
              Media de {moneyEntero(e.compraTrimestre / 3)} al mes; hace falta {moneyEntero(e.cuotaMensual * EXCEDENTE[e.nivel])}
            </span>
          </span>
          <span className="prog-tokens-fila">+{TOKENS.excedente}</span>
        </li>
        <li>
          <Marca estado={e.extras.racha} />
          <span>
            <strong>Racha</strong>
            <span className="stat-sub">Cumplir la cuota mensual todos los meses, este trimestre y el anterior</span>
          </span>
          <span className="prog-tokens-fila">+{TOKENS.racha}</span>
        </li>
        <li>
          <Marca estado={e.extras.variedad} />
          <span>
            <strong>Variedad</strong>
            <span className="stat-sub">
              {n(e.referencias.compradas)} de {n(minimoRef)} productos ASTA distintos este trimestre
            </span>
          </span>
          <span className="prog-tokens-fila">+{TOKENS.variedad}</span>
        </li>
      </ul>

      <p className="stat-sub prog-pie">
        Este trimestre llevas <strong>{n(e.tokens)}</strong> {e.tokens === 1 ? 'token' : 'tokens'}. Se suman a tu saldo al cerrar el trimestre, en {cierre(e.trimestre)}.
      </p>
    </section>
  );
}
