import { cache, Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { nombrePersona, reglaDe } from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { destinoPara } from '@/lib/navegacion';
import { Marco } from '@/components/Marco';
import { Avatar } from '@/components/Avatar';
import { Cifra } from '@/components/Cifras';
import { estaCerca } from '@/components/Categorias';
import { Serie, etiquetaMes } from '@/components/Reporte';
import { Esqueleto, Fallo, HeroMeta, corto, facturas, intentar, n, pct, ultimoMes } from '@/components/inicio/Tablero';
import { getActividadCartera, getCategoriasAstaCartera, getImpulsa, getPortfolio, getReporteCartera } from '@/lib/api';
import { money, moneyCompact, moneyEntero } from '@/lib/formato';

/**
 * Inicio del vendedor: cómo va su cartera y qué hacer hoy.
 *
 * Antes entraba directo a Impulsa, que dice QUÉ ofrecer pero no CÓMO VA. Esta
 * portada junta en una pantalla lo que estaba repartido en cinco:
 *
 *   · Arriba, su cartera en ASTA con la pirámide de categorías en 3D: cuánto
 *     compran sus clientes al mes y cuánto aporta a la meta de la empresa.
 *   · Sus cifras de los últimos doce meses y la serie mes a mes.
 *   · «Para hoy»: los clientes de Impulsa con más dinero en otras marcas.
 *   · «Cerca de subir»: a quién le falta poco para la siguiente categoría.
 *   · «Se están enfriando»: los que compraban y llevan tiempo sin comprar.
 *
 * Cada bloque es una lectura aparte con su `Suspense`, como en el Inicio del
 * administrador. Las categorías se leen UNA vez para los dos bloques que las
 * usan (`cache`), aunque cada uno llegue por su lado.
 */

export const dynamic = 'force-dynamic';

const categorias = cache((token: string) => getCategoriasAstaCartera(token));

// ── Su cartera en ASTA, con la pirámide ────────────────────────────────────────

async function Meta({ token }: { token: string }) {
  const r = await intentar(() => categorias(token));
  if (!r) return <Fallo area="meta" titulo="Tu cartera en ASTA" />;
  return <HeroMeta datos={r} alcance="cartera" base="/categorias" />;
}

// ── Cifras y serie: su reporte de los últimos doce meses ───────────────────────

async function Ventas({ token }: { token: string }) {
  const r = await intentar(() => getReporteCartera(token));
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
          nota={`${facturas(totales.facturas)} · últimos 12 meses, sin IVA`}
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
          etiqueta="Por cobrar"
          valor={moneyCompact(totales.porCobrar)}
          tono={totales.porCobrar > 0 ? 'atencion' : undefined}
          nota="en las facturas con ASTA"
        />
        <Cifra className="dash-kpi" icono="clientes" color="verde" etiqueta="Clientes que compraron" valor={n(totales.clientes)} nota={`ticket promedio ${money(totales.ticketPromedio)}`} />
      </section>

      <section className="panel dash-serie">
        <div className="dash-cabeza">
          <h2>Tu ASTA mes a mes</h2>
          <Link className="dash-mas" href="/reportes">
            Ver tus reportes →
          </Link>
        </div>
        <Serie puntos={r.serieMensual} />
      </section>
    </>
  );
}

// ── Para hoy: lo de Impulsa con más en juego ───────────────────────────────────

async function Hoy({ token }: { token: string }) {
  const r = await intentar(() => getImpulsa(token));
  if (!r) return <Fallo area="hoy" titulo="Para hoy" />;
  const { pendientes } = r.meta;
  const clientes = r.data
    .map((c) => ({ ...c, pendientes: c.sugerencias.filter((s) => s.visible).length }))
    .filter((c) => c.pendientes > 0)
    .sort((a, b) => b.enJuego - a.enJuego)
    .slice(0, 6);

  return (
    <section className="panel dash-hoy">
      <h2>Para hoy</h2>
      <p className="panel-nota">
        {pendientes.sugerencias > 0
          ? `${n(pendientes.sugerencias)} ${pendientes.sugerencias === 1 ? 'sugerencia' : 'sugerencias'} en ${n(pendientes.clientes)} ${pendientes.clientes === 1 ? 'cliente' : 'clientes'} · ${moneyCompact(pendientes.enJuego)} en otras marcas`
          : 'Hoy no hay a quién pasarle a ASTA.'}
      </p>
      {clientes.length > 0 ? (
        <ul className="lista-inicio">
          {clientes.map((c) => (
            <li key={c.partnerId}>
              <Link href="/impulsa">
                <Avatar nombre={c.nombre} tamano="s" />
                <span className="lista-texto">
                  <strong>{c.nombre}</strong>
                  <small>
                    {c.pendientes} {c.pendientes === 1 ? 'producto' : 'productos'} para pasar a ASTA
                  </small>
                </span>
                <span className="lista-dato lista-ambar">{corto(c.enJuego)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">Has atendido todas las sugerencias.</div>
      )}
      <Link className="btn btn-inline dash-hoy-btn" href="/impulsa">
        Abrir Impulsa
      </Link>
    </section>
  );
}

// ── Cerca de subir de categoría ────────────────────────────────────────────────

async function Cerca({ token }: { token: string }) {
  const r = await intentar(() => categorias(token));
  if (!r) return <Fallo area="cerca" titulo="Cerca de subir" />;
  const lista = r.clientes
    .filter(estaCerca)
    .sort((a, b) => (a.siguiente?.faltaMensual ?? 0) - (b.siguiente?.faltaMensual ?? 0))
    .slice(0, 5);

  return (
    <section className="panel dash-cerca">
      <h2>Cerca de subir</h2>
      <p className="panel-nota">Les falta poco para la siguiente categoría de ASTA.</p>
      {lista.length > 0 ? (
        <ul className="lista-inicio">
          {lista.map((c) => {
            const s = c.siguiente!;
            const falta: string[] = [];
            if (s.faltaMensual > 0) falta.push(`+${moneyEntero(s.faltaMensual)}/mes`);
            if (s.faltanMeses > 0) falta.push(`${s.faltanMeses} ${s.faltanMeses === 1 ? 'mes' : 'meses'} más con compra`);
            return (
              <li key={c.clave}>
                <Link href={`/cartera/${c.partnerId}`}>
                  <Avatar nombre={c.nombre} tamano="s" />
                  <span className="lista-texto">
                    <strong>{c.nombre}</strong>
                    <small>
                      {falta.join(' y ')} para {reglaDe(s.categoria).nombre}
                    </small>
                  </span>
                  <span className="lista-dato">{corto(c.compraMensual)}/mes</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">Nadie está a un paso de subir ahora mismo.</div>
      )}
      <Link className="dash-mas" href="/categorias?ver=cerca">
        Ver todos →
      </Link>
    </section>
  );
}

// ── Se están enfriando: compraban y llevan tiempo sin comprar ──────────────────

async function Enfriando({ token }: { token: string }) {
  const [act, port] = await Promise.all([intentar(() => getActividadCartera(token)), intentar(() => getPortfolio(token))]);
  if (!act || !port) return <Fallo area="enfriando" titulo="Se están enfriando" />;
  const nombres = new Map(port.filas.map((f) => [f.id, f.nombre]));
  // Primero los que más compraban: perderlos es lo que más cuesta.
  const lista = act.data
    .filter((a) => (a.estado === 'en_riesgo' || a.estado === 'dormido') && a.facturado12m > 0)
    .sort((a, b) => b.facturado12m - a.facturado12m)
    .slice(0, 5);

  return (
    <section className="panel dash-enfriando">
      <h2>Se están enfriando</h2>
      <p className="panel-nota">Compraban y llevan más de {act.meta.umbrales.enRiesgo} días sin comprar.</p>
      {lista.length > 0 ? (
        <ul className="lista-inicio">
          {lista.map((a) => {
            const nombre = nombres.get(a.partnerId) ?? `Cliente ${a.partnerId}`;
            return (
              <li key={a.partnerId}>
                <Link href={`/cartera/${a.partnerId}`}>
                  <Avatar nombre={nombre} tamano="s" />
                  <span className="lista-texto">
                    <strong>{nombre}</strong>
                    <small>{a.diasSinComprar === null ? 'sin compras' : `${n(a.diasSinComprar)} días sin comprar`}</small>
                  </span>
                  <span className={`lista-dato${a.estado === 'dormido' ? ' lista-rojo' : ' lista-ambar'}`}>{corto(a.facturado12m)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">Ningún cliente que compraba se ha enfriado.</div>
      )}
      <Link className="dash-mas" href="/cartera">
        Ver tu cartera →
      </Link>
    </section>
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

export default async function InicioVendedorPage() {
  const sesion = await requireSession();
  // Es la portada del vendedor: el administrador tiene la suya y un cliente no tiene cartera.
  if (sesion.usuario.role !== 'VENDEDOR') redirect(destinoPara(sesion.usuario.role));
  const token = sesion.accessToken;

  const nombre = nombrePersona(sesion.usuario.nombre).split(' ')[0];
  const hoy = new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Caracas' });

  return (
    <Marco usuario={sesion.usuario} titulo={nombre ? `Hola, ${nombre}` : 'Hola'} descripcion={`Tu cartera hoy, ${hoy} · solo ASTA, sin IVA`}>
      <div className="dash dash-vendedor">
        <Suspense fallback={<Esqueleto area="meta" alto={420} />}>
          <Meta token={token} />
        </Suspense>
        <Suspense fallback={<EsqueletoVentas />}>
          <Ventas token={token} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="hoy" alto={420} />}>
          <Hoy token={token} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="cerca" alto={300} />}>
          <Cerca token={token} />
        </Suspense>
        <Suspense fallback={<Esqueleto area="enfriando" alto={300} />}>
          <Enfriando token={token} />
        </Suspense>
      </div>
    </Marco>
  );
}
