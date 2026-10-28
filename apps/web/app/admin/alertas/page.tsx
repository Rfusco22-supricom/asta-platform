import Link from 'next/link';
import {
  UMBRALES_ALERTAS as U,
  type AlertaConcentracion,
  type AlertaRitmo,
  type AlertaTendencia,
  type EstadoAlerta,
} from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { InsigniaCategoria } from '@/components/Categorias';
import { getAlertasTablero, ApiError, ContractError, esRedireccion } from '@/lib/api';
import { moneyCompact, moneyEntero } from '@/lib/formato';
import { nombreMes } from '@/lib/meses';

/**
 * Las alertas del tablero de ASTA, según el anexo de criterios: el ritmo del
 * mes, la concentración y la cobertura, y la tendencia temprana. Las reglas y
 * los umbrales están en `@asta/shared-types` (`alertasTablero.ts`); aquí solo
 * se cuentan.
 *
 * ── Cada alerta dice qué hacer ───────────────────────────────────────────────
 *
 * Una alerta que solo enseña un porcentaje se aprende a ignorar. Cada una abre
 * con una frase que dice lo que pasa en dinero y en días, y cierra con la lista
 * de a quién llamar o qué reponer.
 */

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('es-VE');
const pct = (x: number) => `${(x * 100).toLocaleString('es-VE', { maximumFractionDigits: 1 })} %`;
const pctEntero = (x: number) => `${Math.round(x * 100).toLocaleString('es-VE')} %`;

const NOMBRE_ESTADO: Record<EstadoAlerta, string> = {
  ok: 'En orden',
  advertencia: 'Advertencia',
  prioritaria: 'Prioritaria',
  pronto: 'Aún pronto',
};

function Estado({ estado }: { estado: EstadoAlerta }) {
  return <span className={`alerta-estado alerta-estado-${estado}`}>{NOMBRE_ESTADO[estado]}</span>;
}

/** «del 19 al 25 oct». */
function semana(desde: string, hasta: string): string {
  const d = (iso: string) => Number(iso.slice(8));
  const mes = (iso: string) => ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(iso.slice(5, 7)) - 1];
  return mes(desde) === mes(hasta) ? `${d(desde)}–${d(hasta)} ${mes(hasta)}` : `${d(desde)} ${mes(desde)}–${d(hasta)} ${mes(hasta)}`;
}

/** Una medida contra su umbral: la barra llena hasta el valor y una raya en el umbral. */
function Medidor({
  titulo,
  valor,
  umbral,
  malo,
  detalle,
}: {
  titulo: string;
  valor: number;
  umbral: number;
  /** Se dispara por encima del umbral (concentración) o por debajo (cobertura). */
  malo: 'encima' | 'debajo';
  detalle: React.ReactNode;
}) {
  const dispara = malo === 'encima' ? valor > umbral : valor < umbral;
  return (
    <div className={`medidor${dispara ? ' medidor-dispara' : ''}`}>
      <div className="medidor-cabeza">
        <span className="medidor-titulo">{titulo}</span>
        <strong>{pct(valor)}</strong>
      </div>
      <div className="medidor-barra" role="img" aria-label={`${pct(valor)}; ${malo === 'encima' ? 'máximo' : 'mínimo'} ${pctEntero(umbral)}`}>
        <span className="medidor-relleno" style={{ width: `${Math.min(100, valor * 100)}%` }} />
        <span className="medidor-umbral" style={{ left: `${umbral * 100}%` }} />
      </div>
      <p className="medidor-detalle">{detalle}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Ritmo({ r }: { r: AlertaRitmo }) {
  const mes = nombreMes(r.mes).split(' ')[0]!.toLowerCase();
  const cumplimiento = r.objetivo > 0 ? r.proyeccion / r.objetivo : 1;
  const tope = Math.max(r.objetivo, r.proyeccion, r.ejecucion) || 1;
  const a = (x: number) => `${Math.min(100, (x / tope) * 100)}%`;

  let mensaje: React.ReactNode;
  if (r.estado === 'pronto') {
    mensaje = <>Van {r.diasHabiles.transcurridos} días hábiles de {mes}: con tan pocos, la proyección todavía no dice nada.</>;
  } else if (r.estado === 'advertencia') {
    mensaje = (
      <>
        A este ritmo {mes} cierra en <strong>{moneyEntero(r.proyeccion)}</strong>, un {pctEntero(cumplimiento)} del objetivo.{' '}
        {r.ritmoNecesario !== null ? (
          <>
            Para llegar hace falta vender <strong>{moneyEntero(r.ritmoNecesario)} por día hábil</strong> en los {r.diasHabiles.restantes} que quedan
            {r.aceleracion !== null ? <>: un {pctEntero(r.aceleracion)} más que ahora ({moneyEntero(r.ritmoActual)} al día).</> : '.'}
          </>
        ) : (
          'Ya no quedan días hábiles en el mes.'
        )}
      </>
    );
  } else {
    mensaje = (
      <>
        A este ritmo {mes} cierra en <strong>{moneyEntero(r.proyeccion)}</strong>, un {pctEntero(cumplimiento)} del objetivo.
      </>
    );
  }

  return (
    <section id="ritmo" className={`panel alerta alerta-${r.estado}`}>
      <header className="alerta-cabeza">
        <div>
          <span className="alerta-numero">1</span>
          <h2>Ritmo del mes</h2>
        </div>
        <Estado estado={r.estado} />
      </header>
      <p className="alerta-mensaje">{mensaje}</p>

      <div className="ritmo-barra" role="img" aria-label={`Llevan ${moneyEntero(r.ejecucion)} de ${moneyEntero(r.objetivo)}; proyección ${moneyEntero(r.proyeccion)}`}>
        <span className="ritmo-proyeccion" style={{ width: a(r.proyeccion) }} />
        <span className="ritmo-ejecucion" style={{ width: a(r.ejecucion) }} />
        <span className="ritmo-marca ritmo-esperado" style={{ left: a(r.esperadoAHoy) }} title={`Esperado a hoy: ${moneyEntero(r.esperadoAHoy)}`} />
        <span className="ritmo-marca ritmo-objetivo" style={{ left: a(r.objetivo) }} title={`Objetivo: ${moneyEntero(r.objetivo)}`} />
      </div>
      <dl className="ritmo-cifras">
        <div>
          <dt>Llevan</dt>
          <dd>{moneyEntero(r.ejecucion)}</dd>
        </div>
        <div>
          <dt>Esperado a hoy</dt>
          <dd>{moneyEntero(r.esperadoAHoy)}</dd>
        </div>
        <div>
          <dt>Proyección</dt>
          <dd>{moneyEntero(r.proyeccion)}</dd>
        </div>
        <div>
          <dt>Objetivo</dt>
          <dd>{moneyEntero(r.objetivo)}</dd>
        </div>
        <div>
          <dt>Días hábiles</dt>
          <dd>
            {r.diasHabiles.transcurridos} de {r.diasHabiles.total}
          </dd>
        </div>
      </dl>
      <p className="panel-nota">
        El objetivo es la suma de las cuotas mensuales de los {n(r.clientes)} clientes con nivel en el Programa ASTA, y «llevan» es lo que esos clientes
        han comprado de ASTA en {mes}. Salta si la proyección por días hábiles queda por debajo del {pctEntero(U.ritmoMinimo)}.
      </p>

      {r.vendedores.length > 0 && (
        <div className="table-wrap">
          <table className="tabla-tarjetas">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th className="num">Clientes</th>
                <th className="num">Objetivo</th>
                <th className="num">Llevan</th>
                <th className="num">Proyección</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {r.vendedores.map((v) => (
                <tr key={v.odooUserId ?? 'sin'}>
                  <td className="c-cliente">{v.vendedor ?? <span className="stat-sub">Sin vendedor</span>}</td>
                  <td className="num" data-etiqueta="Clientes">
                    {n(v.clientes)}
                  </td>
                  <td className="num" data-etiqueta="Objetivo">
                    {moneyEntero(v.objetivo)}
                  </td>
                  <td className="num" data-etiqueta="Llevan">
                    {moneyEntero(v.ejecucion)}
                  </td>
                  <td className="num" data-etiqueta="Proyección">
                    {moneyEntero(v.proyeccion)}
                    {v.objetivo > 0 && <span className="stat-sub"> · {pctEntero(v.proyeccion / v.objetivo)}</span>}
                  </td>
                  <td data-etiqueta="Estado">
                    <Estado estado={v.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Concentracion({ c, ritmo }: { c: AlertaConcentracion; ritmo: EstadoAlerta }) {
  const partes: string[] = [];
  if (c.cobertura.dispara) partes.push(`solo ${n(c.cobertura.activos)} de los ${n(c.cobertura.programados)} clientes con nivel compraron en los últimos ${U.diasActivo} días`);
  if (c.clientes.dispara) partes.push(`${n(c.clientes.primeros)} clientes se llevan el ${pctEntero(c.clientes.parte)} de lo vendido`);
  if (c.catalogo.dispara) partes.push(`${n(c.catalogo.primeros)} referencias hacen el ${pctEntero(c.catalogo.parte)} de la venta`);

  let mensaje: React.ReactNode;
  if (partes.length === 0) {
    mensaje = c.estado === 'pronto' ? 'Con tan pocos días de mes, la concentración todavía no se juzga.' : 'La venta está repartida y los clientes con nivel siguen comprando.';
  } else {
    const frase = partes.join('; ');
    mensaje = (
      <>
        {frase.charAt(0).toUpperCase() + frase.slice(1)}.
        {c.estado === 'prioritaria' && ritmo === 'ok' && <> El ritmo del mes va bien, pero lo sostienen pocos: es la pérdida que la meta esconde.</>}
      </>
    );
  }

  return (
    <section id="concentracion" className={`panel alerta alerta-${c.estado}`}>
      <header className="alerta-cabeza">
        <div>
          <span className="alerta-numero">2</span>
          <h2>Concentración y cobertura</h2>
        </div>
        <Estado estado={c.estado} />
      </header>
      <p className="alerta-mensaje">{mensaje}</p>

      <div className="medidores">
        <Medidor
          titulo="Cobertura de clientes con nivel"
          valor={c.cobertura.parte}
          umbral={U.coberturaMinima}
          malo="debajo"
          detalle={
            <>
              {n(c.cobertura.activos)} de {n(c.cobertura.programados)} compraron en {U.diasActivo} días · mínimo {pctEntero(U.coberturaMinima)}
            </>
          }
        />
        <Medidor
          titulo="Concentración en clientes"
          valor={c.clientes.parte}
          umbral={U.concentracionVolumen}
          malo="encima"
          detalle={
            <>
              Los {n(c.clientes.primeros)} primeros de {n(c.clientes.base)} que compraron · máximo {pctEntero(U.concentracionVolumen)}
            </>
          }
        />
        <Medidor
          titulo="Concentración en el catálogo"
          valor={c.catalogo.parte}
          umbral={U.concentracionVolumen}
          malo="encima"
          detalle={
            <>
              Las {n(c.catalogo.primeros)} primeras de {n(c.catalogo.base)} referencias vendidas · máximo {pctEntero(U.concentracionVolumen)}
            </>
          }
        />
      </div>
      <p className="panel-nota">
        Concentración: lo facturado de ASTA este mes ({moneyCompact(c.volumen)}), y cuánto de eso se llevan menos del {pctEntero(U.concentracionBase)} de
        los clientes o de las referencias.
      </p>

      {c.cobertura.sinCompra.length > 0 && (
        <>
          <h3 className="alerta-subtitulo">Clientes con nivel sin comprar en {U.diasActivo} días</h3>
          <div className="table-wrap">
            <table className="tabla-tarjetas">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Nivel</th>
                  <th>Vendedor</th>
                  <th className="num">Cuota mensual</th>
                </tr>
              </thead>
              <tbody>
                {c.cobertura.sinCompra.map((s) => (
                  <tr key={s.partnerId}>
                    <td className="c-cliente">
                      <Link href={`/cartera/${s.partnerId}`} className="cliente-nombre enlace-ficha">
                        {s.nombre}
                      </Link>
                    </td>
                    <td data-etiqueta="Nivel">
                      <InsigniaCategoria categoria={s.nivel} />
                    </td>
                    <td data-etiqueta="Vendedor">{s.vendedor ?? <span className="stat-sub">sin vendedor</span>}</td>
                    <td className="num" data-etiqueta="Cuota mensual">
                      {moneyEntero(s.cuotaMensual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Tendencia({ t }: { t: AlertaTendencia }) {
  const partes: string[] = [];
  if (t.entrada.dispara && t.entrada.caida !== null)
    partes.push(`lo cotizado la última semana (${moneyEntero(t.entrada.ultima)}) cayó un ${pctEntero(t.entrada.caida)} frente a su media de ${U.semanasMedia} semanas`);
  if (t.conversion.dispara) partes.push(`la conversión de cotización a pedido lleva ${t.conversion.caidasSeguidas} semanas seguidas bajando`);
  if (t.inventario.dispara) partes.push(`${n(t.inventario.productos.length)} productos ASTA tienen stock para menos de ${U.semanasStockMinimo} semanas`);
  const frase = partes.join('; ');

  const tope = Math.max(1, ...t.semanas.flatMap((s) => [s.cotizado, s.facturado]));
  const alto = (x: number) => `${Math.max(0, (x / tope) * 100)}%`;

  return (
    <section id="tendencia" className={`panel alerta alerta-${t.estado}`}>
      <header className="alerta-cabeza">
        <div>
          <span className="alerta-numero">3</span>
          <h2>Tendencia temprana</h2>
        </div>
        <Estado estado={t.estado} />
      </header>
      <p className="alerta-mensaje">
        {partes.length ? `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.` : 'Lo cotizado se mantiene, la conversión no cae y no hay productos a punto de agotarse.'}
      </p>

      <div className="semanas" role="img" aria-label="Cotizado y facturado de ASTA por semana">
        {t.semanas.map((s, i) => (
          <div key={s.desde} className={`semana${i === t.semanas.length - 1 ? ' semana-ultima' : ''}`}>
            <div className="semana-barras">
              <span className="barra-cotizado" style={{ height: alto(s.cotizado) }} title={`Cotizado: ${moneyEntero(s.cotizado)}`} />
              <span className="barra-facturado" style={{ height: alto(s.facturado) }} title={`Facturado: ${moneyEntero(s.facturado)}`} />
              <span className="semana-media" style={{ bottom: alto(t.entrada.media) }} />
            </div>
            <span className="semana-cifra">{s.cotizado >= 10_000 ? moneyCompact(s.cotizado) : moneyEntero(s.cotizado)}</span>
            <span className="semana-conversion" title={`${n(s.confirmadas)} de ${n(s.cotizaciones)} cotizaciones son pedido`}>
              {s.conversion === null ? '—' : pctEntero(s.conversion)}
            </span>
            <span className="semana-fecha">{semana(s.desde, s.hasta)}</span>
          </div>
        ))}
      </div>
      <p className="semanas-leyenda">
        <span>
          <i className="l-cotizado" /> Cotizado
        </span>
        <span>
          <i className="l-facturado" /> Facturado
        </span>
        <span>
          <i className="l-media" /> Media de las {U.semanasMedia} semanas anteriores
        </span>
        <span>El porcentaje es la conversión de cotización a pedido</span>
      </p>
      <p className="panel-nota">
        Lo cotizado son las líneas ASTA de los pedidos creados cada semana, en cualquier estado; salta si la última cae un {pctEntero(U.caidaEntrada)}{' '}
        frente a la media, o si la conversión baja {U.periodosCaida} semanas seguidas.
      </p>

      {t.inventario.productos.length > 0 && (
        <>
          <h3 className="alerta-subtitulo">Productos ASTA que se agotan</h3>
          <div className="table-wrap">
            <table className="tabla-tarjetas">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Sede</th>
                  <th className="num">Libre</th>
                  <th className="num">Venta / semana</th>
                  <th className="num">Alcanza para</th>
                </tr>
              </thead>
              <tbody>
                {t.inventario.productos.map((p) => (
                  <tr key={`${p.sede}-${p.productoId}`}>
                    <td className="c-cliente alerta-producto">
                      <span className="cliente-nombre">{p.codigo ?? p.nombre}</span>
                      {p.codigo && <span className="cliente-contacto">{p.nombre}</span>}
                    </td>
                    <td data-etiqueta="Sede">{p.sede}</td>
                    <td className="num" data-etiqueta="Libre">
                      {n(p.libre)}
                    </td>
                    <td className="num" data-etiqueta="Venta / semana">
                      {n(p.ventaSemanal)}
                    </td>
                    <td className="num" data-etiqueta="Alcanza para">
                      {p.libre <= 0 ? <span className="alerta-agotado">Agotado</span> : `${n(p.semanas)} sem.`}
                      {p.cayendo && <span className="alerta-cayendo">bajando {U.periodosCaida} semanas</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-nota alerta-pie">
            Stock libre en el almacén de cada sede frente a lo vendido por semana en las últimas {U.semanasVenta}.
          </p>
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function AlertasPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getAlertasTablero(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Alertas">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudieron calcular las alertas'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const { ritmo, concentracion, tendencia } = datos;
  const resumen = [
    { id: 'ritmo', titulo: 'Ritmo del mes', estado: ritmo.estado, cifra: ritmo.objetivo > 0 ? `${pctEntero(ritmo.proyeccion / ritmo.objetivo)} proyectado` : 'sin objetivo' },
    { id: 'concentracion', titulo: 'Concentración y cobertura', estado: concentracion.estado, cifra: `${pctEntero(concentracion.cobertura.parte)} de cobertura` },
    {
      id: 'tendencia',
      titulo: 'Tendencia temprana',
      estado: tendencia.estado,
      cifra:
        tendencia.entrada.caida === null
          ? `${n(tendencia.inventario.productos.length)} productos en riesgo`
          : `cotizado ${tendencia.entrada.caida >= 0 ? '−' : '+'}${pctEntero(Math.abs(tendencia.entrada.caida))}`,
    },
  ];
  const encendidas = resumen.filter((r) => r.estado === 'advertencia' || r.estado === 'prioritaria').length;

  return (
    <Marco usuario={sesion.usuario} titulo="Alertas">
      <p className="alertas-intro">
        Solo ASTA, toda la empresa sin Panamá. {encendidas === 0 ? 'Ninguna alerta encendida.' : `${encendidas} de 3 alertas encendidas.`}
      </p>
      <nav className="alertas-resumen" aria-label="Resumen de alertas">
        {resumen.map((r) => (
          <a key={r.id} href={`#${r.id}`} className={`alerta-tarjeta alerta-${r.estado}`}>
            <span className="alerta-tarjeta-titulo">{r.titulo}</span>
            <Estado estado={r.estado} />
            <span className="alerta-tarjeta-cifra">{r.cifra}</span>
          </a>
        ))}
      </nav>
      <Ritmo r={ritmo} />
      <Concentracion c={concentracion} ritmo={ritmo.estado} />
      <Tendencia t={tendencia} />
    </Marco>
  );
}
