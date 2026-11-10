import { cache, Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { nombrePersona } from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { destinoPara } from '@/lib/navegacion';
import { Marco } from '@/components/Marco';
import { Cifra } from '@/components/Cifras';
import { Serie, etiquetaMes } from '@/components/Reporte';
import { Periodos, fechasDe } from '@/components/Periodos';
import { urlCon } from '@/components/Sedes';
import { nombrePeriodo } from '@/lib/meses';
import { Esqueleto, Fallo, HeroMeta, facturas, intentar, n, pct, ultimoMes } from '@/components/inicio/Tablero';
import { TareasVendedor } from '@/components/inicio/TareasVendedor';
import { getCategoriasAstaCartera, getReporteCartera } from '@/lib/api';
import { money, moneyCompact } from '@/lib/formato';

/**
 * «Hoy», la portada del vendedor: cómo va su cartera y a quién llamar hoy.
 *
 *   · Arriba, su cartera en ASTA con la pirámide de categorías en 3D: cuánto
 *     compran sus clientes al mes y cuánto aporta a la meta de la empresa.
 *   · Sus cifras del periodo y la serie mes a mes.
 *   · «Para hoy» (`TareasVendedor`): UNA lista de tareas con lo que antes
 *     estaba repartido entre este Inicio, Impulsa y Cotizaciones —pedidos y
 *     cotizaciones que esperan, quién baja o puede subir de nivel, quién se
 *     enfría y a quién pasarle a ASTA—, lo urgente primero.
 *
 * Cada bloque es una lectura aparte con su `Suspense`, como en el Inicio del
 * administrador.
 */

export const dynamic = 'force-dynamic';

const categorias = cache((token: string) => getCategoriasAstaCartera(token));

// ── Su cartera en ASTA, con la pirámide ────────────────────────────────────────

async function Meta({ token }: { token: string }) {
  const r = await intentar(() => categorias(token));
  if (!r) return <Fallo area="meta" titulo="Tu cartera en ASTA" />;
  return <HeroMeta datos={r} alcance="cartera" base="/categorias" />;
}

// ── Cifras y serie: su reporte del periodo elegido ─────────────────────────────

async function Ventas({ token, rango }: { token: string; rango: { desde: string; hasta: string } }) {
  const r = await intentar(() => getReporteCartera(token, rango));
  const periodo = nombrePeriodo(rango.desde, rango.hasta);
  if (!r) {
    return (
      <>
        <Fallo area="kpis" titulo="Tus cifras" />
        <Fallo area="serie" titulo="Tu ASTA mes a mes" />
      </>
    );
  }
  const { totales } = r;
  const mes = ultimoMes(r.serieMensual);

  return (
    <>
      <section className="stats dash-kpis" aria-label="Tus cifras">
        <Cifra
          className="dash-kpi"
          icono="ventas"
          etiqueta="Vendido en ASTA"
          valor={moneyCompact(totales.facturado)}
          nota={`en ${periodo} · ${facturas(totales.facturas)}, sin IVA`}
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
                ? 'primer mes con ventas'
                : `${mes.cambio >= 0 ? '▲' : '▼'} ${pct(Math.abs(mes.cambio))} frente a ${etiquetaMes(mes.previo.periodo)}`
            }
          />
        ) : (
          <Cifra className="dash-kpi" icono="mes" color="violeta" etiqueta="Último mes" valor="—" nota="sin meses completos todavía" />
        )}
        <Cifra
          className="dash-kpi"
          icono="cobrar"
          color="ambar"
          etiqueta="Por cobrar de ASTA"
          valor={moneyCompact(totales.porCobrar)}
          tono={totales.porCobrar > 0 ? 'atencion' : undefined}
          nota={`a hoy, la parte ASTA de lo que se debe de ${periodo}`}
        />
        <Cifra
          className="dash-kpi"
          icono="clientes"
          color="verde"
          etiqueta="Clientes que compraron"
          valor={n(totales.clientes)}
          nota={`en ${periodo} · ticket promedio ${money(totales.ticketPromedio)}`}
        />
      </section>

      <section className="panel dash-serie">
        <div className="dash-cabeza">
          <h2>Tu ASTA mes a mes</h2>
          <Link className="dash-mas" href={urlCon('/reportes', { periodo: rango, sede: null })}>
            Ver tus reportes →
          </Link>
        </div>
        <Serie puntos={r.serieMensual} />
      </section>
    </>
  );
}

function EsqueletoVentas() {
  return (
    <>
      <div className="stats dash-kpis" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat dash-kpi dash-esqueleto" style={{ minHeight: 140 }} />
        ))}
      </div>
      <Esqueleto area="serie" alto={260} />
    </>
  );
}

export default async function InicioVendedorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const rango =
    typeof params.desde === 'string' && typeof params.hasta === 'string' ? { desde: params.desde, hasta: params.hasta } : fechasDe('12m');
  // Es la portada del vendedor: el administrador tiene la suya y un cliente no tiene cartera.
  if (sesion.usuario.role !== 'VENDEDOR') redirect(destinoPara(sesion.usuario.role));
  const token = sesion.accessToken;

  const nombre = nombrePersona(sesion.usuario.nombre).split(' ')[0];

  return (
    <Marco usuario={sesion.usuario} titulo={nombre ? `Hola, ${nombre}` : 'Hola'}>
      <Periodos base="/inicio" periodo={rango} />
      <div className="dash dash-vendedor">
        <Suspense fallback={<Esqueleto area="meta" alto={420} />}>
          <Meta token={token} />
        </Suspense>
        <Suspense fallback={<EsqueletoVentas />}>
          <Ventas token={token} rango={rango} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="hoy" alto={520} />}>
          <TareasVendedor token={token} />
        </Suspense>
      </div>
    </Marco>
  );
}
