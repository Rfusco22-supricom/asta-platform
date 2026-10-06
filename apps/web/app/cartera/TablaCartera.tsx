'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ActividadCartera, ActividadCliente, ClaseCliente, EstadoCliente, PortfolioRow } from '@asta/shared-types';
import { money, moneyCompact } from '@/lib/formato';

/**
 * Tabla de cartera, con lo que dice de cada cliente su actividad: si sigue
 * comprando (estado), cuánto pesa (clase ABC) y hacia dónde va (tendencia).
 *
 * Es Client Component porque ordenar y filtrar tiene que ser instantáneo: con
 * 791 filas ya cargadas, ir al servidor por cada clic sería absurdo.
 *
 * ── Dos tiempos ──────────────────────────────────────────────────────────────
 *
 * Las filas llegan con la página. La actividad llega DESPUÉS, como una promesa
 * que el Server Component no espera (`page.tsx`): la serie de doce meses de la
 * cartera más grande cuesta ~4,7 s en Odoo, y no tiene sentido que el vendedor
 * mire una pantalla en blanco mientras tanto. Hasta que llega, sus columnas
 * enseñan un hueco animado; si falla, la tabla sigue y se dice por qué.
 */

export type ResultadoActividad = { ok: true; actividad: ActividadCartera } | { ok: false; mensaje: string };

type Columna = 'nombre' | 'clase' | 'estado' | 'facturado12m' | 'tendencia' | 'totalFacturado' | 'porCobrar';

const TIER_CLASS: Record<string, string> = { BRONCE: 'bronce', PLATA: 'plata', GOLD: 'gold' };

const ESTADOS: Array<{ valor: EstadoCliente; etiqueta: string; plural: string }> = [
  { valor: 'activo', etiqueta: 'Activo', plural: 'Activos' },
  { valor: 'nuevo', etiqueta: 'Nuevo', plural: 'Nuevos' },
  { valor: 'en_riesgo', etiqueta: 'En riesgo', plural: 'En riesgo' },
  { valor: 'dormido', etiqueta: 'Dormido', plural: 'Dormidos' },
  { valor: 'prospecto', etiqueta: 'Prospecto', plural: 'Prospectos' },
];
const ETIQUETA_ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.valor, e.etiqueta])) as Record<EstadoCliente, string>;

const CLASES: Array<{ valor: ClaseCliente; detalle: string }> = [
  { valor: 'A', detalle: 'tus clientes clave' },
  { valor: 'B', detalle: 'con margen para crecer' },
  { valor: 'C', detalle: 'compras pequeñas' },
];

/** Orden de los estados de más a menos urgente de atender, para ordenar la columna. */
const PESO_ESTADO: Record<EstadoCliente, number> = { en_riesgo: 0, dormido: 1, nuevo: 2, activo: 3, prospecto: 4 };

function sinAcentos(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function nombreMes(mes: string, conAnio = true): string {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es', { month: 'short', ...(conAnio ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

function alternar<T>(conjunto: Set<T>, valor: T): Set<T> {
  const nuevo = new Set(conjunto);
  if (nuevo.has(valor)) nuevo.delete(valor);
  else nuevo.add(valor);
  return nuevo;
}

export function TablaCartera({ filas, actividad }: { filas: PortfolioRow[]; actividad: Promise<ResultadoActividad> }) {
  const [res, setRes] = useState<ResultadoActividad | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [soloDeuda, setSoloDeuda] = useState(false);
  const [estados, setEstados] = useState<Set<EstadoCliente>>(new Set());
  const [clases, setClases] = useState<Set<ClaseCliente>>(new Set());
  const [orden, setOrden] = useState<Columna>('totalFacturado');
  const [desc, setDesc] = useState(true);

  useEffect(() => {
    let vigente = true;
    actividad.then((r) => vigente && setRes(r));
    return () => {
      vigente = false;
    };
  }, [actividad]);

  const datos = res?.ok ? res.actividad : null;
  const porId = useMemo(() => new Map((datos?.data ?? []).map((a) => [a.partnerId, a])), [datos]);

  /*
   * El nivel de tarifa solo se enseña si distingue a alguien. Hoy todos los
   * clientes están en la misma tarifa y saldrían todos Bronce (#131): una
   * columna que dice lo mismo en cada fila es ruido.
   */
  const conNivel = useMemo(() => new Set(filas.filter((f) => f.esCliente).map((f) => f.tierDerivado)).size > 1, [filas]);

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    let out = filas;
    if (q) out = out.filter((f) => sinAcentos(`${f.nombre} ${f.email ?? ''} ${f.telefono ?? ''}`).includes(q));
    if (soloDeuda) out = out.filter((f) => f.porCobrar > 0);
    if (datos && estados.size > 0) out = out.filter((f) => estados.has(porId.get(f.id)?.estado ?? 'prospecto'));
    if (datos && clases.size > 0) out = out.filter((f) => {
      const c = porId.get(f.id)?.clase;
      return c ? clases.has(c) : false;
    });

    const valor = (f: PortfolioRow): number | string => {
      const a = porId.get(f.id);
      switch (orden) {
        case 'nombre':
          return f.nombre;
        case 'clase':
          // A antes que B antes que C; sin clase, al final.
          return a?.clase ? 3 - 'ABC'.indexOf(a.clase) : -1;
        case 'estado':
          return a ? -(PESO_ESTADO[a.estado] * 100_000 + (a.diasSinComprar ?? 99_999)) : -Infinity;
        case 'facturado12m':
          return a?.facturado12m ?? -Infinity;
        case 'tendencia':
          return a?.tendencia ?? -Infinity;
        default:
          return f[orden];
      }
    };

    return [...out].sort((x, y) => {
      const signo = desc ? -1 : 1;
      const vx = valor(x);
      const vy = valor(y);
      if (typeof vx === 'string' && typeof vy === 'string') return signo * vx.localeCompare(vy, 'es');
      return signo * ((vx as number) - (vy as number)) || x.nombre.localeCompare(y.nombre, 'es');
    });
  }, [filas, busqueda, soloDeuda, estados, clases, orden, desc, datos, porId]);

  function ordenarPor(col: Columna) {
    if (col === orden) setDesc(!desc);
    else {
      setOrden(col);
      // El nombre se lee de la A a la Z; lo demás interesa de más a menos.
      setDesc(col !== 'nombre');
    }
  }

  const flecha = (col: Columna) => (col === orden ? <span className="arrow">{desc ? '↓' : '↑'}</span> : null);
  const hayFiltros = busqueda !== '' || soloDeuda || estados.size > 0 || clases.size > 0;

  return (
    <>
      <Clasificacion
        res={res}
        estados={estados}
        clases={clases}
        alEstado={(e) => setEstados((s) => alternar(s, e))}
        alClase={(c) => setClases((s) => alternar(s, c))}
      />

      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Buscar por nombre, correo o teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar en la cartera"
        />

        <div className="segmented" role="group" aria-label="Filtrar por deuda">
          <button type="button" aria-pressed={!soloDeuda} onClick={() => setSoloDeuda(false)}>
            Todos
          </button>
          <button type="button" aria-pressed={soloDeuda} onClick={() => setSoloDeuda(true)}>
            Con deuda
          </button>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setBusqueda('');
              setSoloDeuda(false);
              setEstados(new Set());
              setClases(new Set());
            }}
          >
            Quitar filtros
          </button>
        )}

        <span className="count">{visibles.length === filas.length ? `${filas.length} clientes` : `${visibles.length} de ${filas.length}`}</span>
      </div>

      <div className="table-wrap">
        <table className="tabla-cartera tabla-tarjetas">
          <thead>
            <tr>
              <th className="sortable" onClick={() => ordenarPor('nombre')}>
                Cliente {flecha('nombre')}
              </th>
              <th className="sortable col-clase" onClick={() => ordenarPor('clase')} title="Por lo que compra de ASTA en 12 meses · A: el 80 % de tus ventas de ASTA · B: el 15 % siguiente · C: el resto">
                Clase {flecha('clase')}
              </th>
              <th className="sortable" onClick={() => ordenarPor('estado')}>
                Estado {flecha('estado')}
              </th>
              {conNivel && <th className="col-nivel">Nivel</th>}
              <th className="sortable num col-serie" onClick={() => ordenarPor('facturado12m')}>
                Últimos 12 meses {flecha('facturado12m')}
              </th>
              <th className="sortable num" onClick={() => ordenarPor('tendencia')} title="Los tres últimos meses completos frente a los tres anteriores">
                Tendencia {flecha('tendencia')}
              </th>
              <th className="sortable num" onClick={() => ordenarPor('totalFacturado')}>
                Histórico {flecha('totalFacturado')}
              </th>
              <th className="sortable num" onClick={() => ordenarPor('porCobrar')}>
                Por cobrar {flecha('porCobrar')}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const a = porId.get(f.id);
              const cargando = res === null;
              return (
                <tr key={f.id} className="linked">
                  <td className="c-cliente">
                    {/* El enlace envuelve el contenido y no la fila: un <a> no
                        puede contener <td>, y con onClick se perdería abrir en
                        pestaña nueva con ctrl+clic. */}
                    <Link href={`/cartera/${f.id}`} className="row-link">
                      <div className="cliente-nombre">{f.nombre}</div>
                      {(f.email || f.telefono) && <div className="cliente-contacto">{[f.email, f.telefono].filter(Boolean).join(' · ')}</div>}
                    </Link>
                  </td>
                  <td className="col-clase c-clase" data-etiqueta="Clase">{cargando ? <Hueco ancho={22} /> : a?.clase ? <span className={`clase clase-${a.clase}`}>{a.clase}</span> : <span className="zero">—</span>}</td>
                  <td className="c-estado" data-etiqueta="Estado">{cargando ? <Hueco ancho={86} /> : a ? <Estado a={a} /> : <span className="zero">—</span>}</td>
                  {conNivel && (
                    <td className="col-nivel c-nivel" data-etiqueta="Nivel">
                      {f.esCliente ? <span className={`tag ${TIER_CLASS[f.tierDerivado] ?? 'bronce'}`}>{f.tierDerivado}</span> : <span className="zero">—</span>}
                    </td>
                  )}
                  <td className="num col-serie c-12m" data-etiqueta="Últimos 12 meses">
                    {cargando ? (
                      <Hueco ancho={130} />
                    ) : a && datos ? (
                      <div className="serie-celda">
                        <MiniSerie serie={a.serie} meses={datos.meta.meses} />
                        <span className={a.facturado12m === 0 ? 'zero' : ''}>{a.facturado12m === 0 ? '—' : moneyCompact(a.facturado12m)}</span>
                      </div>
                    ) : (
                      <span className="zero">—</span>
                    )}
                  </td>
                  <td className="num c-tendencia" data-etiqueta="Tendencia">{cargando ? <Hueco ancho={48} /> : <Tendencia valor={a?.tendencia ?? null} />}</td>
                  <td className={`num c-historico ${f.totalFacturado === 0 ? 'zero' : ''}`} data-etiqueta="Histórico">{f.totalFacturado === 0 ? '—' : money(f.totalFacturado)}</td>
                  <td className={`num c-cobrar ${f.porCobrar > 0 ? 'debt' : 'zero'}`} data-etiqueta="Por cobrar">{f.porCobrar === 0 ? '—' : money(f.porCobrar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibles.length === 0 && (
          <div className="empty">{busqueda ? `Ningún cliente coincide con "${busqueda}".` : 'No hay clientes que mostrar con estos filtros.'}</div>
        )}
      </div>
    </>
  );
}

/** Las dos clasificaciones de la cartera, que además filtran la tabla al tocarlas. */
function Clasificacion({
  res,
  estados,
  clases,
  alEstado,
  alClase,
}: {
  res: ResultadoActividad | null;
  estados: Set<EstadoCliente>;
  clases: Set<ClaseCliente>;
  alEstado: (e: EstadoCliente) => void;
  alClase: (c: ClaseCliente) => void;
}) {
  if (res && !res.ok) {
    return (
      <div className="notice error clasificacion-error">
        <p>No se pudo calcular cómo está cada cliente: {res.mensaje} La tabla de abajo sí está al día.</p>
      </div>
    );
  }

  const datos = res?.ok ? res.actividad : null;
  const filas = datos?.data ?? [];
  const cuenta = (e: EstadoCliente) => filas.filter((f) => f.estado === e).length;
  const total12m = filas.reduce((s, f) => s + Math.max(0, f.facturado12m), 0);
  const deClase = (c: ClaseCliente) => {
    const de = filas.filter((f) => f.clase === c);
    return { n: de.length, monto: de.reduce((s, f) => s + f.facturado12m, 0) };
  };

  return (
    <section className="clasificacion" aria-busy={!datos}>
      <div className="panel clasificacion-bloque">
        <div className="clasificacion-titulo">
          <h2>Estado de compra</h2>
          {datos && (
            <span>
              Activo: compró ASTA hace menos de {datos.meta.umbrales.enRiesgo} días · dormido: más de {datos.meta.umbrales.dormido}
            </span>
          )}
        </div>
        {datos ? (
          <>
            <div className="reparto" role="img" aria-label="Reparto de clientes por estado de compra">
              {ESTADOS.map(({ valor }) => {
                const n = cuenta(valor);
                return n > 0 ? <span key={valor} className={`reparto-${valor}`} style={{ flexGrow: n }} title={`${ETIQUETA_ESTADO[valor]}: ${n}`} /> : null;
              })}
            </div>
            <div className="fichas">
              {ESTADOS.map(({ valor, plural }) => (
                <button key={valor} type="button" className={`ficha ficha-${valor}`} aria-pressed={estados.has(valor)} onClick={() => alEstado(valor)}>
                  <span className="ficha-punto" />
                  {plural}
                  <strong>{cuenta(valor)}</strong>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <Hueco ancho="100%" alto={12} />
            <div className="fichas">
              {ESTADOS.map(({ valor }) => (
                <Hueco key={valor} ancho={104} alto={30} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="panel clasificacion-bloque">
        <div className="clasificacion-titulo">
          <h2>ASTA · últimos 12 meses</h2>
          {datos && <span>{moneyCompact(total12m)} vendido</span>}
        </div>
        <div className="clases">
          {CLASES.map(({ valor, detalle }) => {
            if (!datos) return <Hueco key={valor} ancho="100%" alto={58} />;
            const { n, monto } = deClase(valor);
            const pct = total12m > 0 ? Math.round((monto / total12m) * 100) : 0;
            return (
              <button key={valor} type="button" className="clase-boton" aria-pressed={clases.has(valor)} onClick={() => alClase(valor)}>
                <span className={`clase clase-${valor}`}>{valor}</span>
                <span className="clase-texto">
                  <strong>
                    {n} {n === 1 ? 'cliente' : 'clientes'}
                  </strong>
                  <small>
                    {pct} % de tus ventas · {detalle}
                  </small>
                </span>
                <span className="clase-barra">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Estado({ a }: { a: ActividadCliente }) {
  const detalle =
    a.estado === 'prospecto'
      ? 'sin compras de ASTA'
      : a.diasSinComprar === 0
        ? 'compró hoy'
        : a.diasSinComprar === 1
          ? 'hace 1 día'
          : `hace ${a.diasSinComprar} días`;
  return (
    <span className="estado-celda">
      <span className={`estado estado-${a.estado}`}>{ETIQUETA_ESTADO[a.estado]}</span>
      <small>{detalle}</small>
    </span>
  );
}

function Tendencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="zero">—</span>;
  // ±5 % es ruido de un pedido más o menos: se lee como estable.
  if (Math.abs(valor) < 5) return <span className="tendencia tendencia-igual">≈ estable</span>;
  // Con base mínima (`BASE_MINIMA_TENDENCIA`) aún salen saltos grandes: por
  // encima de +300 % ya solo importa que sube mucho.
  return valor > 0 ? (
    <span className="tendencia tendencia-sube" title={`${valor} %`}>
      ▲ {valor > 300 ? '+300' : valor} %
    </span>
  ) : (
    <span className="tendencia tendencia-baja">▼ {Math.abs(valor)} %</span>
  );
}

/** Doce barras, una por mes. La del mes en curso, más clara: todavía no ha terminado. */
function MiniSerie({ serie, meses }: { serie: number[]; meses: string[] }) {
  const max = Math.max(...serie, 0);
  const ancho = 6;
  const hueco = 2;
  const alto = 26;
  return (
    <svg className="mini-serie" width={serie.length * (ancho + hueco) - hueco} height={alto} role="img" aria-label="Facturado mes a mes, últimos 12 meses">
      {serie.map((v, i) => {
        const h = max > 0 && v > 0 ? Math.max(2, (v / max) * alto) : 1;
        return (
          <rect
            key={meses[i] ?? i}
            x={i * (ancho + hueco)}
            y={alto - h}
            width={ancho}
            height={h}
            rx={1.5}
            className={v > 0 ? (i === serie.length - 1 ? 'mes-curso' : 'mes-lleno') : 'mes-vacio'}
            style={{ animationDelay: `${i * 25}ms` }}
          >
            <title>{`${nombreMes(meses[i] ?? '')}: ${v === 0 ? 'sin ASTA' : money(v)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Un hueco animado mientras llega la actividad. */
function Hueco({ ancho, alto = 14 }: { ancho: number | string; alto?: number }) {
  return <span className="hueco" style={{ width: ancho, height: alto }} aria-hidden="true" />;
}

