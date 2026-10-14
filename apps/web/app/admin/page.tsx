import { Suspense } from 'react';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos, fechasDe } from '@/components/Periodos';
import { Sedes, sedeDeParams, urlCon } from '@/components/Sedes';
import { nombreSede, type SedeId } from '@asta/shared-types';
import { reglaDe, type ClaveCategoria } from '@asta/shared-types';
import { Proporcion, Serie, etiquetaMes } from '@/components/Reporte';
import { estaCerca, ventana } from '@/components/Categorias';
import { PiramideCategorias, type NivelPiramide } from '@/components/inicio/PiramideCategorias';
import { COLORES_CATEGORIAS } from '@/components/tres/colores';
import { esRedireccion, getAstaEmpresa, getCategoriasAstaEmpresa, getReporteEmpresa, getReporteProductosEmpresa, type Reporte } from '@/lib/api';
import { money, moneyCompact, moneyEntero } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';

/**
 * Inicio del administrador: cómo va ASTA.
 *
 * La marca propia es lo que el panel existe para empujar, así que la portada
 * contesta lo que se pregunta primero: cuánto se vende, si sube o baja, qué
 * parte del consumible se lleva ASTA frente a las otras marcas, qué y a quién
 * se vende, y cuánto queda por ganar. Lo que hay por hacer está en Pendientes.
 *
 * Cuatro lecturas independientes, cada una con su `Suspense`: las categorías
 * (el bloque de arriba, con la pirámide en 3D), el reporte de la empresa
 * (cifras, serie, vendedores, clientes), los productos y la oportunidad. La
 * página sale enseguida y cada bloque llega cuando responde Odoo; si uno falla,
 * solo ese bloque lo dice.
 */

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('es-VE');
const facturas = (x: number) => `${n(x)} ${x === 1 ? 'factura' : 'facturas'}`;
const pct = (x: number) => `${x.toLocaleString('es-VE', { maximumFractionDigits: 1 })} %`;

type Rango = { desde: string; hasta: string };

function rangoDe(params: Record<string, string | string[] | undefined>): Rango | undefined {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  return desde && hasta ? { desde, hasta } : undefined;
}

async function intentar<T>(leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return null;
  }
}

function Fallo({ area, titulo }: { area: string; titulo: string }) {
  return (
    <section className={`panel dash-${area} dash-fallo`}>
      <h2>{titulo}</h2>
      <p className="panel-nota">No se pudo leer de Odoo ahora. Recarga en un momento.</p>
    </section>
  );
}

function Esqueleto({ area, alto = 120 }: { area: string; alto?: number }) {
  return <div className={`panel dash-${area} dash-esqueleto`} style={{ minHeight: alto }} aria-busy="true" />;
}

// ── Cifras, serie, vendedores y clientes: el reporte de la empresa ─────────────

/** El último mes COMPLETO frente al anterior: el mes en curso todavía no se puede comparar. */
function ultimoMes(serie: Reporte['serieMensual']) {
  const hoy = new Date().toISOString().slice(0, 7);
  const completos = serie.filter((p) => p.periodo < hoy);
  const ultimo = completos.at(-1);
  const previo = completos.at(-2);
  if (!ultimo) return null;
  const cambio = previo && previo.monto > 0 ? ((ultimo.monto - previo.monto) / previo.monto) * 100 : null;
  return { ultimo, previo, cambio };
}

function Ranking<T>({
  area,
  titulo,
  nota,
  filas,
  nombre,
  valor,
  enlace,
  pie,
}: {
  area: string;
  titulo: string;
  nota?: string;
  filas: T[];
  nombre: (f: T) => React.ReactNode;
  valor: (f: T) => number;
  enlace?: { href: string; texto: string };
  pie?: (f: T) => React.ReactNode;
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
                {nombre(f)}
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

async function Ventas({ token, rango, sede }: { token: string; rango: Rango; sede: SedeId | null }) {
  const r = await intentar(() => getReporteEmpresa(token, rango, sede));
  if (!r) {
    return (
      <>
        <Fallo area="kpis" titulo="ASTA en cifras" />
        <Fallo area="serie" titulo="ASTA mes a mes" />
      </>
    );
  }
  const { totales, asta } = r;
  const mes = ultimoMes(r.serieMensual);
  const reportes = urlCon('/admin/reportes', { periodo: rango, sede });

  return (
    <>
      <section className="stats dash-kpis" aria-label="ASTA en cifras">
        <Cifra
          className="dash-kpi"
          icono="ventas"
          etiqueta="Vendido en ASTA"
          valor={moneyCompact(totales.facturado)}
          nota={`${facturas(totales.facturas)} · sin IVA, neto de devoluciones`}
          tendencia={r.serieMensual.map((p) => p.monto)}
        />
        {mes ? (
          <Cifra
            className="dash-kpi"
            icono="mes"
            color="violeta"
            etiqueta={`Último mes · ${etiquetaMes(mes.ultimo.periodo)}`}
            valor={moneyCompact(mes.ultimo.monto)}
            tono={mes.cambio === null ? undefined : mes.cambio >= 0 ? 'sube' : 'baja'}
            nota={
              mes.cambio === null || !mes.previo
                ? 'primer mes con ventas del periodo'
                : `${mes.cambio >= 0 ? '▲' : '▼'} ${pct(Math.abs(mes.cambio))} frente a ${etiquetaMes(mes.previo.periodo)}`
            }
          />
        ) : (
          <Cifra className="dash-kpi" icono="mes" color="violeta" etiqueta="Último mes" valor="—" nota="sin meses completos en el periodo" />
        )}
        <Cifra
          className="dash-kpi"
          icono="cuota"
          color="rosa"
          etiqueta="Cuota de ASTA"
          valor={pct(asta.cuota)}
          nota={`del consumible que compran los clientes · ${moneyCompact(asta.competencia)} se va a otras marcas`}
        />
        <Cifra
          className="dash-kpi"
          icono="clientes"
          color="verde"
          etiqueta="Clientes que compran ASTA"
          valor={n(totales.clientes)}
          nota={`ticket promedio ${money(totales.ticketPromedio)}`}
        />
        <Cifra className="dash-kpi" icono="cobrar" color="ambar" etiqueta="Por cobrar" valor={moneyCompact(totales.porCobrar)} nota="en las facturas con ASTA" />
      </section>

      <section className="panel dash-serie">
        <div className="dash-cabeza">
          <h2>ASTA mes a mes</h2>
          <Link className="dash-mas" href={reportes}>
            Ver el reporte completo →
          </Link>
        </div>
        <Serie puntos={r.serieMensual} />
      </section>

      <Ranking
        area="vendedores"
        titulo="Vendedores"
        nota="Por el comercial de cada cliente."
        filas={(r.porVendedor ?? []).slice(0, 8)}
        nombre={(v) => v.nombre}
        valor={(v) => v.facturado}
        pie={(v) => facturas(v.facturas)}
        enlace={{ href: urlCon('/admin/agentes', { sede }), texto: 'Todos los vendedores' }}
      />

      <Ranking
        area="clientes"
        titulo="Clientes"
        filas={r.topClientes.slice(0, 8)}
        nombre={(c) => (c.partnerId ? <Link href={`/cartera/${c.partnerId}`}>{c.nombre}</Link> : c.nombre)}
        valor={(c) => c.facturado}
        pie={(c) => facturas(c.facturas)}
        enlace={{ href: reportes, texto: 'Ver más clientes' }}
      />
    </>
  );
}

function EsqueletoVentas() {
  return (
    <>
      <div className="stats dash-kpis" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="stat dash-kpi dash-esqueleto" style={{ minHeight: 104 }} />
        ))}
      </div>
      <Esqueleto area="serie" alto={230} />
      <Esqueleto area="vendedores" alto={300} />
      <Esqueleto area="clientes" alto={300} />
    </>
  );
}

// ── Productos ──────────────────────────────────────────────────────────────────

async function Productos({ token, rango, sede }: { token: string; rango: Rango; sede: SedeId | null }) {
  const r = await intentar(() => getReporteProductosEmpresa(token, rango, sede));
  if (!r) return <Fallo area="productos" titulo="Productos ASTA más vendidos" />;
  const productos = r.categorias
    .flatMap((c) => c.productos)
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 8);
  return (
    <Ranking
      area="productos"
      titulo="Productos"
      nota={`${n(r.totales.productos)} productos ASTA distintos vendidos en el periodo.`}
      filas={productos}
      nombre={(p) => p.nombre.replace(/^ASTA\s+/i, '')}
      valor={(p) => p.monto}
      pie={(p) => `${n(Math.round(p.cantidad))} u. · ${n(p.clientes.length)} clientes`}
    />
  );
}

// ── Oportunidad ────────────────────────────────────────────────────────────────

async function Oportunidad({ token, sede }: { token: string; sede: SedeId | null }) {
  const r = await intentar(() => getAstaEmpresa(token, sede));
  if (!r) return <Fallo area="oportunidad" titulo="Lo que queda por ganar" />;
  const { totales: t } = r;
  return (
    <section className="panel dash-oportunidad">
      <h2>Lo que queda por ganar</h2>
      <div className="dash-cuota">
        {/* La cuota como anillo: lo lleno es ASTA, lo vacío lo que se llevan las otras marcas. */}
        <div className="anillo" role="img" aria-label={`ASTA ${pct(t.cuota)} del consumible`} style={{ '--p': Math.min(100, t.cuota) } as React.CSSProperties}>
          <span>{pct(t.cuota)}</span>
        </div>
        <div className="stat-sub">
          {moneyCompact(t.asta)} en ASTA frente a {moneyCompact(t.competencia)} en otras marcas, en los {n(t.clientes)} clientes que compran consumibles.
        </div>
      </div>
      <div className="dash-oport-dato">
        <strong>{n(t.sinAsta)}</strong> clientes compran consumibles y nunca han probado ASTA
        <span>{moneyCompact(t.sinAstaImporte)} en otras marcas</span>
      </div>
      <Link className="btn btn-inline dash-oport-btn" href={urlCon('/admin/asta', { sede })}>
        Ver a quién ofrecerle ASTA
      </Link>
    </section>
  );
}

// ── Camino a la meta: las categorías de ASTA (#131), con la pirámide en 3D ─────

/** De abajo arriba, como las láminas de la pirámide. */
const DE_ABAJO_ARRIBA: ClaveCategoria[] = ['GENERAL', 'BRONCE', 'PLATA', 'ORO', 'DIAMANTE'];

/** Compacto a partir de 10.000 y entero por debajo, como en `Categorias.tsx`. */
const corto = (x: number) => (Math.abs(x) >= 10_000 ? moneyCompact(x) : moneyEntero(x));

/**
 * Lo primero del Inicio: cuánto se compra de ASTA al mes frente a la meta de
 * 100.000, cuánto pone cada categoría, y la pirámide que se puede tocar.
 *
 * De toda la empresa siempre: la categoría es del cliente, no de la sede.
 */
async function Meta({ token }: { token: string }) {
  const r = await intentar(() => getCategoriasAstaEmpresa(token));
  if (!r) return <Fallo area="meta" titulo="Camino a la meta" />;

  const avance = r.meta > 0 ? Math.min(100, (r.compraMensual / r.meta) * 100) : 0;
  const enPrograma = r.porCategoria.filter((c) => c.categoria !== 'GENERAL').reduce((s, c) => s + c.clientes, 0);
  const cerca = r.clientes.filter(estaCerca).length;
  const porClave = new Map(r.porCategoria.map((c) => [c.categoria, c]));

  const niveles: NivelPiramide[] = DE_ABAJO_ARRIBA.map((clave, i) => {
    const c = porClave.get(clave);
    const regla = reglaDe(clave);
    const clientes = c?.clientes ?? 0;
    const metaClientes = c?.metaClientes ?? null;
    return {
      clave,
      nombre: regla.nombre,
      color: COLORES_CATEGORIAS[i]!,
      clientes: metaClientes === null ? `${n(clientes)} clientes` : `${n(clientes)} de ${n(metaClientes)} clientes`,
      compra: `${corto(c?.compraMensual ?? 0)} USD/mes`,
      meta: `meta ${corto(c?.metaCompraMensual ?? 0)} USD/mes`,
      regla:
        regla.minimoMensual > 0
          ? `≥ ${moneyEntero(regla.minimoMensual)}/mes y ${regla.minimoMeses} de 4 meses`
          : `< ${moneyEntero(reglaDe('BRONCE').minimoMensual)}/mes`,
      avance: metaClientes ? Math.min(100, (clientes / metaClientes) * 100) : null,
      href: `/admin/categorias?ver=${clave}`,
    };
  });

  return (
    <section className="panel dash-meta hero-meta">
      <div className="hero-texto">
        <span className="hero-etiqueta">Camino a {moneyEntero(r.meta)} USD/mes</span>
        <div className="hero-cifra">
          <strong>{moneyCompact(r.compraMensual)}</strong>
          <span>de {moneyCompact(r.meta)} al mes</span>
        </div>

        {/* Cuánto pone cada categoría: un tramo de su color por categoría. */}
        <div className="hero-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(avance)} aria-label="Avance hacia la meta">
          {[...niveles].reverse().map((nv) => {
            const c = porClave.get(nv.clave as ClaveCategoria);
            const ancho = r.meta > 0 ? ((c?.compraMensual ?? 0) / r.meta) * 100 : 0;
            return ancho > 0 ? <span key={nv.clave} style={{ width: `${ancho}%`, background: nv.color }} title={`${nv.nombre}: ${nv.compra}`} /> : null;
          })}
        </div>

        <p className="hero-nota">
          Faltan <strong>{moneyCompact(Math.max(0, r.meta - r.compraMensual))}</strong> al mes. {n(enPrograma)} clientes en el programa
          {cerca > 0 && (
            <>
              {' '}
              y <strong>{n(cerca)}</strong> {cerca === 1 ? 'está' : 'están'} cerca de subir de categoría
            </>
          )}
          . Promedio de ASTA de {ventana(r.meses)}, sin IVA.
        </p>

        <div className="hero-acciones">
          <Link className="btn btn-inline" href="/admin/categorias?ver=cerca">
            Ver quién está cerca de subir
          </Link>
          <Link className="dash-mas" href="/admin/categorias">
            Todas las categorías →
          </Link>
        </div>
      </div>

      <PiramideCategorias niveles={niveles} />
    </section>
  );
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const rango = rangoDe(params) ?? fechasDe('12m');
  const sede = sedeDeParams(params);
  const token = sesion.accessToken;
  const donde = sede === null ? 'ASTA en toda la empresa' : `ASTA en ${nombreSede(sede)}`;

  return (
    <Marco usuario={sesion.usuario} titulo="Inicio" descripcion={`${donde} · sin IVA · ${rango.desde} a ${rango.hasta}`}>
      <Sedes base="/admin" sede={sede} periodo={rango} />
      <Periodos base="/admin" periodo={rango} sede={sede} />

      <div className="dash">
        <Suspense fallback={<EsqueletoVentas />}>
          <Ventas token={token} rango={rango} sede={sede} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="meta" alto={420} />}>
          <Meta token={token} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="oportunidad" alto={230} />}>
          <Oportunidad token={token} sede={sede} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="productos" alto={300} />}>
          <Productos token={token} rango={rango} sede={sede} />
        </Suspense>
      </div>
    </Marco>
  );
}
