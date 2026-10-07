import { Suspense } from 'react';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import {
  esRedireccion,
  getAgentes,
  getCalidadDatos,
  getCoberturaTop,
  getDuplicadosInforme,
  getEstadisticasRecomendador,
  getKioscos,
  getLoteAsta,
  getLoteFabricante,
  getPorImpresora,
  getSinAcceso,
} from '@/lib/api';
import { moneyCompact } from '@/lib/formato';

/**
 * Pendientes del administrador: lo que hay por hacer, sección por sección.
 *
 * Fue la portada hasta el 2026-10-07, cuando el inicio pasó a ser el tablero de
 * ASTA; las mismas tarjetas viven aquí.
 *
 * ── Por qué una portada y no la primera sección ──────────────────────────────
 *
 * Cada sección sabe lo suyo —cuántos tóners faltan por validar, cuántos datos
 * de Odoo están mal, si una tablet dejó de conectarse—, pero para enterarse había
 * que entrar en las nueve. La portada pregunta a todas y enseña una tarjeta por
 * pendiente, con el enlace al sitio donde se resuelve.
 *
 * ── Cada tarjeta por su cuenta ───────────────────────────────────────────────
 *
 * Unas tardan milisegundos (MySQL) y otras segundos (Odoo). Cada tarjeta es su
 * propio componente con `Suspense`: la página sale enseguida y cada cifra llega
 * cuando llega. Si una falla, dice «no se pudo leer» en su sitio y las demás
 * siguen; una portada que se cae entera porque Odoo tarda no sirve de portada.
 */

export const dynamic = 'force-dynamic';

type Estado = 'ok' | 'pendiente' | 'alerta';

const n = (x: number) => x.toLocaleString('es-VE');

function Tarjeta({
  titulo,
  estado,
  cifra,
  detalle,
  href,
  accion,
  progreso,
}: {
  titulo: string;
  estado: Estado;
  cifra: string;
  detalle: React.ReactNode;
  href: string;
  accion: string;
  /** 0–100, para las que miden un avance. */
  progreso?: number;
}) {
  return (
    <Link href={href} className={`ini-tarjeta ini-${estado}`}>
      <div className="ini-cabeza">
        <span className="ini-punto" aria-hidden="true" />
        <span className="ini-titulo">{titulo}</span>
        <span className="sr-only">
          {estado === 'ok' ? '(al día)' : estado === 'alerta' ? '(urgente)' : '(pendiente)'}
        </span>
      </div>
      <div className="ini-cifra">{cifra}</div>
      {progreso !== undefined && (
        <div className="ini-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progreso)}>
          <span style={{ width: `${Math.max(0, Math.min(100, progreso))}%` }} />
        </div>
      )}
      <div className="ini-detalle">{detalle}</div>
      <span className="ini-accion">{accion} →</span>
    </Link>
  );
}

function Cargando({ titulo }: { titulo: string }) {
  return (
    <div className="ini-tarjeta ini-cargando" aria-busy="true">
      <div className="ini-cabeza">
        <span className="ini-punto" aria-hidden="true" />
        <span className="ini-titulo">{titulo}</span>
      </div>
      <div className="ini-esqueleto" />
      <div className="ini-esqueleto corto" />
    </div>
  );
}

function SinDatos({ titulo, href }: { titulo: string; href: string }) {
  return (
    <Tarjeta titulo={titulo} estado="pendiente" cifra="—" detalle="No se pudo leer ahora. Dentro de la sección se ve el motivo." href={href} accion="Abrir" />
  );
}

/** Ejecuta la lectura y, si falla, pinta la tarjeta vacía. Un login caducado sí se propaga. */
async function intentar<T>(leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return null;
  }
}

// ── Kiosco ───────────────────────────────────────────────────────────────────

async function ImpresorasListas({ token }: { token: string }) {
  const r = await intentar(() => getPorImpresora(token, { vista: 'listas' }));
  const href = '/admin/compatibilidades/impresoras?vista=listas';
  if (!r) return <SinDatos titulo="Impresoras listas" href={href} />;
  const { listas, todas } = r.meta.porVista;
  const pct = todas ? (listas / todas) * 100 : 0;
  return (
    <Tarjeta
      titulo="Impresoras listas"
      estado={listas === 0 ? 'alerta' : pct < 50 ? 'pendiente' : 'ok'}
      cifra={`${n(listas)} de ${n(todas)}`}
      progreso={pct}
      detalle={listas === 0 ? 'Ninguna tiene un tóner validado: el kiosco manda a todos al mostrador.' : 'Con al menos un tóner validado.'}
      href={href}
      accion="Ver impresoras"
    />
  );
}

async function PorValidar({ token }: { token: string }) {
  const [fab, asta, orig] = await Promise.all([
    intentar(() => getLoteFabricante(token)),
    intentar(() => getLoteAsta(token, 'ASTA')),
    intentar(() => getLoteAsta(token, 'ORIGINAL')),
  ]);
  const href = '/admin/compatibilidades/impresoras';
  if (!fab && !asta && !orig) return <SinDatos titulo="Listo para validar" href={href} />;
  const f = fab?.propuestas ?? 0;
  const a = asta?.data.length ?? 0;
  const o = orig?.data.length ?? 0;
  const total = f + a + o;
  return (
    <Tarjeta
      titulo="Listo para validar"
      estado={total === 0 ? 'ok' : 'alerta'}
      cifra={total === 0 ? 'Nada' : n(total)}
      detalle={
        total === 0 ? (
          'No queda ningún caso claro pendiente.'
        ) : (
          <>
            Casos claros que se validan con un clic: {n(f)} de listas oficiales, {n(a)} productos ASTA y {n(o)} originales.
          </>
        )
      }
      href={f > 0 ? href : '/admin/compatibilidades'}
      accion={f > 0 ? 'Validar impresoras' : 'Validar productos'}
    />
  );
}

async function Cobertura({ token }: { token: string }) {
  const r = await intentar(() => getCoberturaTop(token));
  const href = '/admin/compatibilidades';
  if (!r || !r.odooDisponible) return <SinDatos titulo="Cobertura del top" href={href} />;
  const { completos, top, porcentaje, tramo } = r.totales;
  return (
    <Tarjeta
      titulo="Cobertura del top"
      estado={tramo === 'procede' ? 'ok' : tramo === 'con_respaldo' ? 'pendiente' : 'alerta'}
      cifra={`${porcentaje} %`}
      progreso={porcentaje}
      detalle={`${n(completos)} de los ${n(top)} productos más vendidos se pueden recomendar. El objetivo es pasar del 85 %.`}
      href={href}
      accion="Ver cobertura"
    />
  );
}

async function Tablets({ token }: { token: string }) {
  const r = await intentar(() => getKioscos(token));
  const href = '/admin/kioscos';
  if (!r) return <SinDatos titulo="Tablets" href={href} />;
  const activas = r.data.filter((k) => k.activo);
  const dia = Date.now() - 24 * 60 * 60_000;
  const calladas = activas.filter((k) => !k.ultimaConexion || new Date(k.ultimaConexion).getTime() < dia);
  return (
    <Tarjeta
      titulo="Tablets"
      estado={activas.length === 0 ? 'pendiente' : calladas.length > 0 ? 'alerta' : 'ok'}
      cifra={activas.length === 0 ? 'Ninguna' : `${n(activas.length - calladas.length)} de ${n(activas.length)}`}
      detalle={
        activas.length === 0
          ? 'No hay ninguna tablet dada de alta.'
          : calladas.length === 0
            ? 'Todas se han conectado en las últimas 24 horas.'
            : `Sin conectarse en 24 horas: ${calladas.map((k) => k.nombre).join(', ')}.`
      }
      href={href}
      accion="Ver kioscos"
    />
  );
}

async function SinResultado({ token }: { token: string }) {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 30 * 24 * 60 * 60_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const r = await intentar(() => getEstadisticasRecomendador(token, { desde: iso(desde), hasta: iso(hasta) }));
  const href = '/admin/recomendador';
  if (!r) return <SinDatos titulo="Sin resultado" href={href} />;
  const { busquedas, sinResultado } = r.totales;
  return (
    <Tarjeta
      titulo="Sin resultado"
      estado={sinResultado === 0 ? 'ok' : 'pendiente'}
      cifra={n(sinResultado)}
      detalle={
        busquedas === 0
          ? 'Nadie ha buscado en el kiosco en los últimos 30 días.'
          : `Búsquedas del kiosco que no encontraron impresora: ${n(sinResultado)} de ${n(busquedas)} en 30 días. Cada una es un alias que falta o una impresora que no está.`
      }
      href={href}
      accion="Añadir alias"
    />
  );
}

// ── Datos de Odoo ────────────────────────────────────────────────────────────

async function Calidad({ token }: { token: string }) {
  const r = await intentar(() => getCalidadDatos(token));
  const href = '/admin/calidad';
  if (!r) return <SinDatos titulo="Calidad de datos" href={href} />;
  const de = (g: string) => r.revisiones.filter((x) => x.gravedad === g).reduce((s, x) => s + x.total, 0);
  const alta = de('alta');
  const media = de('media');
  return (
    <Tarjeta
      titulo="Calidad de datos"
      estado={alta > 0 ? 'alerta' : media > 0 ? 'pendiente' : 'ok'}
      cifra={alta + media === 0 ? 'Al día' : n(alta + media)}
      detalle={
        alta + media === 0
          ? 'Nada que mueva dinero ni rompa nada.'
          : `${n(alta)} mueven dinero (clientes o facturas sin vendedor) y ${n(media)} rompen algo (RIF, correos).`
      }
      href={href}
      accion="Corregir en Odoo"
    />
  );
}

async function Duplicados({ token }: { token: string }) {
  const r = await intentar(() => getDuplicadosInforme(token));
  const href = '/admin/duplicados';
  if (!r) return <SinDatos titulo="Clientes duplicados" href={href} />;
  const { partidos, montoPartido } = r.resumen;
  const noventa = r.fusionesPara.find((f) => f.porcentaje === 90);
  return (
    <Tarjeta
      titulo="Clientes duplicados"
      estado={partidos === 0 ? 'ok' : 'pendiente'}
      cifra={partidos === 0 ? 'Ninguno' : `${n(partidos)} fusiones`}
      detalle={
        partidos === 0
          ? 'Ningún cliente tiene la facturación repartida.'
          : `${moneyCompact(montoPartido)} repartidos entre fichas.${noventa && noventa.fusiones > 0 ? ` Con ${n(noventa.fusiones)} se arregla el 90 %.` : ''}`
      }
      href={href}
      accion="Ver por dónde empezar"
    />
  );
}

async function Accesos({ token }: { token: string }) {
  const [sin, agentes] = await Promise.all([intentar(() => getSinAcceso(token, 1)), intentar(() => getAgentes(token))]);
  const href = '/admin/usuarios';
  if (!sin && !agentes) return <SinDatos titulo="Sin acceso" href={href} />;
  const vendedores = agentes?.totales.sinAcceso ?? 0;
  const clientes = sin?.total ?? 0;
  return (
    <Tarjeta
      titulo="Sin acceso"
      estado={vendedores > 0 ? 'alerta' : clientes > 0 ? 'pendiente' : 'ok'}
      cifra={vendedores > 0 ? `${n(vendedores)} vendedores` : n(clientes)}
      detalle={
        vendedores > 0
          ? `Trabajan hoy y no pueden ver su cartera. Además, ${n(clientes)} cuentas de cliente esperan su invitación.`
          : `${n(clientes)} cuentas de cliente esperan su invitación.`
      }
      href={vendedores > 0 ? '/admin/agentes' : href}
      accion="Invitar"
    />
  );
}

function Grupo({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <section className="ini-grupo" aria-label={titulo}>
      <div className="ini-grupo-cabeza">
        <h2>{titulo}</h2>
        <p>{nota}</p>
      </div>
      <div className="ini-rejilla">{children}</div>
    </section>
  );
}

export default async function PendientesPage() {
  const sesion = await requireSession();
  const token = sesion.accessToken;

  const conCarga = (titulo: string, tarjeta: React.ReactNode) => <Suspense fallback={<Cargando titulo={titulo} />}>{tarjeta}</Suspense>;

  return (
    <Marco usuario={sesion.usuario} titulo="Pendientes" descripcion="Lo que hay por hacer hoy, sección por sección. Cada tarjeta lleva a donde se resuelve.">
      <div className="ini-leyenda" aria-hidden="true">
        <span className="ini-alerta"><i /> Urgente</span>
        <span className="ini-pendiente"><i /> Pendiente</span>
        <span className="ini-ok"><i /> Al día</span>
      </div>

      <Grupo titulo="Kiosco" nota="Lo que hace falta para que la tablet recomiende tóner ASTA.">
        {conCarga('Listo para validar', <PorValidar token={token} />)}
        {conCarga('Impresoras listas', <ImpresorasListas token={token} />)}
        {conCarga('Cobertura del top', <Cobertura token={token} />)}
        {conCarga('Tablets', <Tablets token={token} />)}
        {conCarga('Sin resultado', <SinResultado token={token} />)}
      </Grupo>

      <Grupo titulo="Datos de Odoo" nota="Se arregla en Odoo; aquí solo se ve qué y dónde.">
        {conCarga('Calidad de datos', <Calidad token={token} />)}
        {conCarga('Clientes duplicados', <Duplicados token={token} />)}
        {conCarga('Sin acceso', <Accesos token={token} />)}
      </Grupo>
    </Marco>
  );
}
