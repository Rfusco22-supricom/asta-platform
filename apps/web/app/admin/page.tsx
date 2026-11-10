import { Suspense } from 'react';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos, fechasDe } from '@/components/Periodos';
import { nombrePeriodo } from '@/lib/meses';
import { Sedes, sedeDeParams, urlCon } from '@/components/Sedes';
import type { SedeId } from '@asta/shared-types';
import { Serie, etiquetaMes } from '@/components/Reporte';
import { Esqueleto, Fallo, HeroMeta, facturas, intentar, n, pct, ultimoMes } from '@/components/inicio/Tablero';
import { Ranking } from '@/components/inicio/Ranking';
import { Atencion } from '@/components/inicio/Atencion';
import { getAlertasTablero, getCategoriasAstaEmpresa, getReporteEmpresa } from '@/lib/api';
import { BarraAlertas } from '@/components/alertas/BarraAlertas';
import { Concentracion, Ritmo, Tendencia, resumenAlertas } from '@/components/alertas/DetalleAlertas';
import { money, moneyCompact } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';

/**
 * Inicio del administrador: cómo va ASTA.
 *
 * La marca propia es lo que el panel existe para empujar, así que la portada
 * contesta lo que se pregunta primero: cuánto se vende, si sube o baja, qué
 * hay que atender hoy y quién vende y compra más. El detalle vive en su
 * sección: los productos en Ventas, la oportunidad (clientes sin ASTA) en
 * Clientes, y cada pendiente en el sitio donde se resuelve.
 *
 * Lecturas independientes, cada una con su `Suspense`: las alertas, las
 * categorías (la pirámide en 3D), el reporte de la empresa (cifras, serie,
 * vendedores, clientes) y «Necesita tu atención». La página sale enseguida y
 * cada bloque llega cuando responde Odoo; si uno falla, solo ese bloque lo dice.
 */

export const dynamic = 'force-dynamic';

type Rango = { desde: string; hasta: string };

function rangoDe(params: Record<string, string | string[] | undefined>): Rango | undefined {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  return desde && hasta ? { desde, hasta } : undefined;
}

// ── Cifras, serie, vendedores y clientes: el reporte de la empresa ─────────────

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
  const { totales } = r;
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
        <Cifra className="dash-kpi" icono="ticket" color="rosa" etiqueta="Ticket promedio" valor={money(totales.ticketPromedio)} nota={`de ASTA por factura, en ${periodo}`} />
        <Cifra
          className="dash-kpi"
          icono="clientes"
          color="verde"
          etiqueta="Clientes que compran ASTA"
          valor={n(totales.clientes)}
          nota={`con al menos una compra en ${periodo}`}
        />
        <Cifra className="dash-kpi" icono="cobrar" color="ambar" etiqueta="Por cobrar de ASTA" valor={moneyCompact(totales.porCobrar)} nota={`a hoy, la parte ASTA de lo que se debe de ${periodo}`} />
      </section>

      <section className="panel dash-serie">
        <div className="dash-cabeza">
          <h2>ASTA mes a mes</h2>
          <Link className="dash-mas" href={reportes}>
            Ver en Ventas →
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
        privado
      />

      <Ranking
        area="clientes"
        titulo="Clientes"
        filas={r.topClientes.slice(0, 8)}
        nombre={(c) => (c.partnerId ? <Link href={`/cartera/${c.partnerId}`}>{c.nombre}</Link> : c.nombre)}
        valor={(c) => c.facturado}
        pie={(c) => facturas(c.facturas)}
        enlace={{ href: reportes, texto: 'Todos los clientes en Ventas' }}
        privado
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

// ── Camino a la meta: las categorías de ASTA (#131), con la pirámide en 3D ─────

/**
 * De toda la empresa siempre: la meta es de la empresa y la categoría es del
 * cliente, no de la sede. La cifra grande es lo vendido en ASTA en el último
 * mes del periodo elegido (el mes del filtro, o el que va en curso).
 */
async function Meta({ token, rango }: { token: string; rango: Rango }) {
  const delMes = { desde: `${rango.hasta.slice(0, 7)}-01`, hasta: rango.hasta };
  const [r, ventas] = await Promise.all([intentar(() => getCategoriasAstaEmpresa(token)), intentar(() => getReporteEmpresa(token, delMes, null))]);
  if (!r) return <Fallo area="meta" titulo="Camino a la meta" />;
  const enCurso = rango.hasta.slice(0, 7) === new Date().toISOString().slice(0, 7);
  const mes = ventas ? { vendido: ventas.totales.facturado, nombre: nombrePeriodo(delMes.desde, delMes.hasta), enCurso } : null;
  return <HeroMeta datos={r} alcance="empresa" base="/admin/categorias" mes={mes} />;
}

/**
 * Las alertas del tablero, lo primero de la portada: tres tarjetas de color y el
 * detalle de cada una en una ventana (`BarraAlertas`). No dependen de la sede ni
 * del periodo elegidos: miran el mes en curso de toda la empresa.
 */
async function Alertas({ token }: { token: string }) {
  const r = await intentar(() => getAlertasTablero(token));
  if (!r) {
    return (
      <section className="alertas-barra dash-fallo">
        <p className="panel-nota">No se pudieron calcular las alertas ahora. Recarga en un momento.</p>
      </section>
    );
  }
  return (
    <BarraAlertas
      resumen={resumenAlertas(r)}
      detalles={{
        ritmo: <Ritmo r={r.ritmo} />,
        concentracion: <Concentracion c={r.concentracion} ritmo={r.ritmo.estado} />,
        tendencia: <Tendencia t={r.tendencia} />,
      }}
    />
  );
}

function EsqueletoAlertas() {
  return (
    <section className="alertas-barra" aria-busy="true">
      <div className="alertas-barra-cabeza">
        <h2>Alertas</h2>
        <span className="alertas-barra-nota">Calculando…</span>
      </div>
      <div className="alertas-resumen">
        {[0, 1, 2].map((i) => (
          <div key={i} className="alerta-tarjeta dash-esqueleto" style={{ minHeight: 76 }} />
        ))}
      </div>
    </section>
  );
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const rango = rangoDe(params) ?? fechasDe('12m');
  const sede = sedeDeParams(params);
  const token = sesion.accessToken;

  return (
    <Marco usuario={sesion.usuario} titulo="Inicio">
      <Suspense fallback={<EsqueletoAlertas />}>
        <Alertas token={token} />
      </Suspense>
      <Sedes base="/admin" sede={sede} periodo={rango} />
      <Periodos base="/admin" periodo={rango} sede={sede} />

      <div className="dash">
        <Suspense fallback={<EsqueletoVentas />}>
          <Ventas token={token} rango={rango} sede={sede} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="meta" alto={420} />}>
          <Meta token={token} rango={rango} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="atencion" alto={360} />}>
          <Atencion token={token} />
        </Suspense>
      </div>
    </Marco>
  );
}
