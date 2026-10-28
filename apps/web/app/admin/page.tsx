import { Suspense } from 'react';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos, fechasDe } from '@/components/Periodos';
import { nombrePeriodo } from '@/lib/meses';
import { Sedes, sedeDeParams, urlCon } from '@/components/Sedes';
import type { SedeId } from '@asta/shared-types';
import { Proporcion, Serie, etiquetaMes } from '@/components/Reporte';
import { Esqueleto, Fallo, HeroMeta, facturas, intentar, n, pct, ultimoMes } from '@/components/inicio/Tablero';
import { getAstaEmpresa, getCategoriasAstaEmpresa, getReporteEmpresa, getReporteProductosEmpresa } from '@/lib/api';
import { money, moneyCompact } from '@/lib/formato';
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

type Rango = { desde: string; hasta: string };

function rangoDe(params: Record<string, string | string[] | undefined>): Rango | undefined {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  return desde && hasta ? { desde, hasta } : undefined;
}

// ── Cifras, serie, vendedores y clientes: el reporte de la empresa ─────────────

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
  const periodo = nombrePeriodo(rango.desde, rango.hasta);
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
          nota={`en ${periodo} · ${facturas(totales.facturas)}`}
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
          nota={`en ${periodo} · ${moneyCompact(asta.competencia)} en otras marcas`}
        />
        <Cifra
          className="dash-kpi"
          icono="clientes"
          color="verde"
          etiqueta="Clientes que compran ASTA"
          valor={n(totales.clientes)}
          nota={`en ${periodo} · ticket promedio ${money(totales.ticketPromedio)}`}
        />
        <Cifra className="dash-kpi" icono="cobrar" color="ambar" etiqueta="Por cobrar" valor={moneyCompact(totales.porCobrar)} nota={`a hoy, de las facturas con ASTA de ${periodo}`} />
      </section>

      <section className="panel dash-serie">
        <div className="dash-cabeza">
          <h2>ASTA mes a mes</h2>
          <Link className="dash-mas" href={reportes}>
            Ver el reporte completo →
          </Link>
        </div>
        <Serie puntos={r.serieMensual} sede={sede} />
      </section>

      <Ranking
        area="vendedores"
        titulo="Vendedores"
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
      nota={`${n(r.totales.productos)} distintos`}
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
          {moneyCompact(t.asta)} en ASTA · {moneyCompact(t.competencia)} en otras marcas
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

/** De toda la empresa siempre: la categoría es del cliente, no de la sede. */
async function Meta({ token }: { token: string }) {
  const r = await intentar(() => getCategoriasAstaEmpresa(token));
  if (!r) return <Fallo area="meta" titulo="Camino a la meta" />;
  return <HeroMeta datos={r} alcance="empresa" base="/admin/categorias" />;
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const rango = rangoDe(params) ?? fechasDe('12m');
  const sede = sedeDeParams(params);
  const token = sesion.accessToken;

  return (
    <Marco usuario={sesion.usuario} titulo="Inicio">
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
