import Link from 'next/link';
import { ESCALERA, nombreTrimestre, reglaDe, type ClientePrograma, type EvaluacionTrimestre, type ProgramaEmpresa } from '@asta/shared-types';
import { InsigniaCategoria } from '@/components/Categorias';
import { etiquetaMes } from '@/lib/meses';
import { moneyEntero } from '@/lib/formato';

/**
 * El programa de ASTA visto por Supricom (administrador y vendedor): cada
 * cliente en el trimestre en curso, con los tres obligatorios, los extras, sus
 * tokens y qué le pasará al cerrar. Lo mismo que el cliente ve de sí mismo
 * (`ProgramaCliente`). Reglas en `@asta/shared-types` (`programaAsta.ts`).
 */

const n = (x: number) => x.toLocaleString('es-VE');

/** Qué le pasará al cerrar: ya sube, ya baja, o todavía está en juego. */
export function alCerrar(e: EvaluacionTrimestre): 'sube' | 'baja' | 'juego' {
  const o = e.obligatorios;
  if (o.mensual === false || o.trimestral === false || o.sellout === false) return 'baja';
  return o.mensual && o.trimestral && o.sellout ? 'sube' : 'juego';
}

/** «oct», «oct y nov», «oct, nov y dic». */
function enumerar(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`;
}

/** Lo que le falta a uno que está en juego, en pocas palabras: para llamarlo. */
export function loQueLeFalta(e: EvaluacionTrimestre): string {
  const partes: string[] = [];
  const falta = e.cuotaTrimestral - e.compraTrimestre;
  if (e.obligatorios.trimestral === null && falta > 0) partes.push(`faltan ${moneyEntero(falta)} del trimestre`);
  const sinMinimo = e.meses.filter((m) => m.cumpleMinimo === null).map((m) => etiquetaMes(m.mes).split(' ')[0]);
  if (sinMinimo.length) partes.push(`mínimo de ${enumerar(sinMinimo)}`);
  const sinSellout = e.meses.filter((m) => m.sellout === null).map((m) => etiquetaMes(m.mes).split(' ')[0]);
  if (sinSellout.length) partes.push(`sell-out de ${enumerar(sinSellout)}`);
  return partes.join(' · ');
}

export const FILTROS_PROGRAMA = [
  { valor: 'programa', titulo: 'En el programa' },
  { valor: 'juego', titulo: 'En juego' },
  { valor: 'suben', titulo: 'Suben' },
  { valor: 'bajan', titulo: 'Bajan' },
  ...[...ESCALERA].reverse().map((nivel) => ({ valor: nivel, titulo: reglaDe(nivel).nombre })),
] as const;

function filtrar(clientes: ClientePrograma[], filtro: string): ClientePrograma[] {
  const faltaDe = (c: ClientePrograma) => c.evaluacion.cuotaTrimestral - c.evaluacion.compraTrimestre;
  if (filtro === 'juego') return clientes.filter((c) => alCerrar(c.evaluacion) === 'juego').sort((a, b) => faltaDe(a) - faltaDe(b));
  if (filtro === 'suben') return clientes.filter((c) => alCerrar(c.evaluacion) === 'sube');
  if (filtro === 'bajan') return clientes.filter((c) => alCerrar(c.evaluacion) === 'baja' && c.evaluacion.nivel !== 'GENERAL');
  if ((ESCALERA as readonly string[]).includes(filtro)) return clientes.filter((c) => c.evaluacion.nivel === filtro);
  return clientes.filter((c) => c.evaluacion.nivel !== 'GENERAL');
}

function Puntos({ estados, titulo }: { estados: Array<{ mes: string; estado: boolean | null }>; titulo: string }) {
  return (
    <span className="prog-puntos" aria-label={titulo}>
      {estados.map((s) => (
        <span
          key={s.mes}
          className={`prog-punto ${s.estado === true ? 'ok' : s.estado === false ? 'no' : ''}`}
          title={`${etiquetaMes(s.mes)}: ${s.estado === true ? 'cumplido' : s.estado === false ? 'no cumplido' : 'pendiente'}`}
        />
      ))}
    </span>
  );
}

function AlCerrar({ e }: { e: EvaluacionTrimestre }) {
  const estado = alCerrar(e);
  if (estado === 'juego') return <span className="prog-cierre">En juego</span>;
  const mueve = ESCALERA.indexOf(e.nivelFinal) - ESCALERA.indexOf(e.nivel);
  return (
    <span className={`prog-cierre ${mueve > 0 ? 'ok' : mueve < 0 ? 'no' : ''}`}>
      {mueve > 0 ? '↑' : mueve < 0 ? '↓' : '='} {reglaDe(e.nivelFinal).nombre}
    </span>
  );
}

export function TablaPrograma({ datos, filtro, base, conVendedor }: { datos: ProgramaEmpresa; filtro: string; base: string; conVendedor: boolean }) {
  const filas = filtrar(datos.clientes, filtro);
  const cuenta = (v: string) => filtrar(datos.clientes, v).length;
  return (
    <section className="panel">
      <h2>El trimestre · {nombreTrimestre(datos.trimestre)}</h2>
      <p className="panel-nota">
        Cumplir la cuota mensual, la del trimestre y el sell-out de los tres meses sube un nivel; fallar uno baja uno. «En juego»: todavía puede cumplir los tres.
      </p>
      <nav className="pi-vistas cat-filtros" aria-label="Qué clientes ver">
        {FILTROS_PROGRAMA.map((f) => (
          <Link key={f.valor} href={`${base}?ver=${f.valor}`} aria-current={f.valor === filtro ? 'page' : undefined}>
            {f.titulo}
            <span className="pi-cuenta">{n(cuenta(f.valor))}</span>
          </Link>
        ))}
      </nav>

      {filas.length === 0 ? (
        <div className="empty">Ningún cliente en esta lista.</div>
      ) : (
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="tabla-tarjetas tabla-programa">
            <thead>
              <tr>
                <th>Cliente</th>
                {conVendedor && <th>Vendedor</th>}
                <th>Nivel</th>
                <th>Mensual</th>
                <th className="num">Trimestre</th>
                <th>Sell-out</th>
                <th className="num">Extras</th>
                <th className="num">Tokens</th>
                <th>Al cerrar</th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, 300).map((c) => {
                const e = c.evaluacion;
                const extras = [e.extras.excedente, e.extras.racha, e.extras.variedad].filter((x) => x === true).length;
                const juego = alCerrar(e) === 'juego';
                return (
                  <tr key={c.clave}>
                    <td className="c-cliente">
                      <Link href={`/cartera/${c.partnerId}`} className="cliente-nombre enlace-ficha">
                        {c.nombre}
                      </Link>
                      {juego && <div className="cliente-contacto">{loQueLeFalta(e)}</div>}
                    </td>
                    {conVendedor && <td data-etiqueta="Vendedor">{c.vendedor ?? <span className="stat-sub">sin vendedor</span>}</td>}
                    <td data-etiqueta="Nivel">
                      <InsigniaCategoria categoria={e.nivel} />
                    </td>
                    <td data-etiqueta={`Mínimo ${moneyEntero(e.cuotaMensual)}/mes`}>
                      <Puntos titulo="Cuota mensual" estados={e.meses.map((m) => ({ mes: m.mes, estado: m.cumpleMinimo }))} />
                    </td>
                    <td className="num" data-etiqueta="Trimestre">
                      {moneyEntero(e.compraTrimestre)} <span className="stat-sub">de {moneyEntero(e.cuotaTrimestral)}</span>
                    </td>
                    <td data-etiqueta="Sell-out">
                      <Puntos titulo="Sell-out" estados={e.meses.map((m) => ({ mes: m.mes, estado: m.sellout }))} />
                    </td>
                    <td className="num" data-etiqueta="Extras">
                      {extras}/3
                    </td>
                    <td className="num" data-etiqueta="Tokens" title="Este trimestre · acumulados">
                      +{e.tokens} <span className="stat-sub">· {n(c.saldoTokens)}</span>
                    </td>
                    <td data-etiqueta="Al cerrar">
                      <AlCerrar e={e} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filas.length > 300 && <p className="stat-sub">Se muestran 300 de {n(filas.length)}.</p>}
    </section>
  );
}
