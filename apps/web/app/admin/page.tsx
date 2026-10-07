import { Suspense } from 'react';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos, fechasDe } from '@/components/Periodos';
import { Proporcion, Serie, etiquetaMes } from '@/components/Reporte';
import { esRedireccion, getAstaEmpresa, getReporteEmpresa, getReporteProductosEmpresa, type Reporte } from '@/lib/api';
import { money, moneyCompact } from '@/lib/formato';

/**
 * Inicio del administrador: cómo va ASTA.
 *
 * La marca propia es lo que el panel existe para empujar, así que la portada
 * contesta lo que se pregunta primero: cuánto se vende, si sube o baja, qué
 * parte del consumible se lleva ASTA frente a las otras marcas, qué y a quién
 * se vende, y cuánto queda por ganar. Lo que hay por hacer está en Pendientes.
 *
 * Tres lecturas independientes, cada una con su `Suspense`: el reporte de la
 * empresa (cifras, serie, vendedores, clientes), los productos y la oportunidad.
 * La página sale enseguida y cada bloque llega cuando responde Odoo; si uno
 * falla, solo ese bloque lo dice.
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

function Kpi({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: string; nota: React.ReactNode; tono?: 'sube' | 'baja' }) {
  return (
    <div className="stat dash-kpi">
      <div className="stat-label">{etiqueta}</div>
      <div className={`stat-value${tono ? ` dash-${tono}` : ''}`}>{valor}</div>
      <div className="stat-sub">{nota}</div>
    </div>
  );
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

async function Ventas({ token, rango }: { token: string; rango: Rango }) {
  const r = await intentar(() => getReporteEmpresa(token, rango));
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
  const reportes = `/admin/reportes?desde=${rango.desde}&hasta=${rango.hasta}`;

  return (
    <>
      <section className="stats dash-kpis" aria-label="ASTA en cifras">
        <Kpi etiqueta="Vendido en ASTA" valor={moneyCompact(totales.facturado)} nota={`${facturas(totales.facturas)} · sin IVA, neto de devoluciones`} />
        {mes ? (
          <Kpi
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
          <Kpi etiqueta="Último mes" valor="—" nota="sin meses completos en el periodo" />
        )}
        <Kpi
          etiqueta="Cuota de ASTA"
          valor={pct(asta.cuota)}
          nota={`del consumible que compran los clientes · ${moneyCompact(asta.competencia)} se va a otras marcas`}
        />
        <Kpi etiqueta="Clientes que compran ASTA" valor={n(totales.clientes)} nota={`ticket promedio ${money(totales.ticketPromedio)}`} />
        <Kpi etiqueta="Por cobrar" valor={moneyCompact(totales.porCobrar)} nota="en las facturas con ASTA" />
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
        enlace={{ href: '/admin/agentes', texto: 'Todos los vendedores' }}
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

async function Productos({ token, rango }: { token: string; rango: Rango }) {
  const r = await intentar(() => getReporteProductosEmpresa(token, rango));
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

async function Oportunidad({ token }: { token: string }) {
  const r = await intentar(() => getAstaEmpresa(token));
  if (!r) return <Fallo area="oportunidad" titulo="Lo que queda por ganar" />;
  const { totales: t } = r;
  return (
    <section className="panel dash-oportunidad">
      <h2>Lo que queda por ganar</h2>
      <div className="dash-cuota">
        <div className="dash-cuota-cifra">{pct(t.cuota)}</div>
        <div className="dash-cuota-barra" role="img" aria-label={`ASTA ${pct(t.cuota)} del consumible`}>
          <span style={{ width: `${Math.min(100, t.cuota)}%` }} />
        </div>
        <div className="stat-sub">
          {moneyCompact(t.asta)} en ASTA frente a {moneyCompact(t.competencia)} en otras marcas, en los {n(t.clientes)} clientes que compran consumibles.
        </div>
      </div>
      <div className="dash-oport-dato">
        <strong>{n(t.sinAsta)}</strong> clientes compran consumibles y nunca han probado ASTA
        <span>{moneyCompact(t.sinAstaImporte)} en otras marcas</span>
      </div>
      <Link className="btn btn-inline dash-oport-btn" href="/admin/asta">
        Ver a quién ofrecerle ASTA
      </Link>
    </section>
  );
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const rango = rangoDe(await searchParams) ?? fechasDe('12m');
  const token = sesion.accessToken;

  return (
    <Marco usuario={sesion.usuario} titulo="Inicio" descripcion={`ASTA en toda la empresa · sin IVA · ${rango.desde} a ${rango.hasta}`}>
      <Periodos base="/admin" periodo={rango} />

      <div className="dash">
        <Suspense fallback={<EsqueletoVentas />}>
          <Ventas token={token} rango={rango} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="oportunidad" alto={230} />}>
          <Oportunidad token={token} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="productos" alto={300} />}>
          <Productos token={token} rango={rango} />
        </Suspense>
      </div>
    </Marco>
  );
}
