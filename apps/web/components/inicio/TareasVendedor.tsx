import Link from 'next/link';
import { DIAS_SIN_RESPUESTA, reglaDe, subir, bajar } from '@asta/shared-types';
import { getActividadCartera, getCotizacionesCartera, getImpulsa, getPedidosParaAtender, getPortfolio, getProgramaCartera } from '@/lib/api';
import { fechasDe } from '@/components/Periodos';
import { alCerrar, loQueLeFalta } from '@/components/ProgramaStaff';
import { moneyEntero } from '@/lib/formato';
import { intentar, n } from './Tablero';

/**
 * «Para hoy» del vendedor: a quién llamar y para qué, en UNA lista ordenada por
 * lo que más urge. Junta lo que estaba repartido en el Inicio, Impulsa y
 * Cotizaciones (reorganización del 2026-11-10):
 *
 *   1. pedidos sugeridos que le envió un cliente y nadie ha atendido;
 *   2. cotizaciones sin respuesta hace más de `DIAS_SIN_RESPUESTA` días;
 *   3. clientes que ya fallaron un obligatorio del trimestre y bajan de nivel;
 *   4. clientes en juego: si cumplen lo que les falta, suben;
 *   5. clientes que compraban ASTA y se están enfriando;
 *   6. clientes que compran originales que tienen su ASTA (Impulsa).
 *
 * Solo montos de ASTA. Cada grupo enseña sus primeros `POR_GRUPO` y enlaza al
 * resto. Cada lectura va por su cuenta: si una falla, su grupo no sale.
 */

const POR_GRUPO = 5;

type Tono = 'alerta' | 'pendiente' | 'oportunidad';

interface Tarea {
  clave: string;
  cliente: string;
  partnerId: number;
  motivo: string;
  tono: Tono;
  detalle: string;
  accion: { texto: string; href: string };
}

interface Grupo {
  tareas: Tarea[];
  /** Cuántas hay en total, si son más de las que se enseñan. */
  total: number;
  todas?: { texto: string; href: string };
}

const dias = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const cuantos = (x: number, uno: string, varios: string) => `${n(x)} ${x === 1 ? uno : varios}`;

async function pedidos(token: string): Promise<Grupo> {
  const r = await intentar(() => getPedidosParaAtender(token, 'cartera'));
  if (!r) throw new Error('pedidos');
  const tareas = r.map((p) => ({
    clave: `pedido-${p.id}`,
    cliente: p.cliente,
    partnerId: p.partnerId,
    motivo: 'Pedido sugerido',
    tono: 'alerta' as const,
    detalle: `Lo envió ${dias(p.enviadoEn) === 0 ? 'hoy' : `hace ${cuantos(dias(p.enviadoEn), 'día', 'días')}`}: ${cuantos(p.unidades, 'unidad', 'unidades')}${p.importeEstimado ? `, unos ${moneyEntero(p.importeEstimado)}` : ''}.`,
    accion: { texto: 'Atender pedido', href: '/cotizaciones' },
  }));
  return { tareas: tareas.slice(0, POR_GRUPO), total: tareas.length, todas: { texto: 'Ver todos los pedidos', href: '/cotizaciones' } };
}

async function cotizaciones(token: string): Promise<Grupo> {
  const r = await intentar(() => getCotizacionesCartera(token, fechasDe('12m'), 'abierta'));
  if (!r) throw new Error('cotizaciones');
  // Las que más ASTA llevan, primero: una de hace meses y $20 vale menos llamada que una de $2.000.
  const sin = r.filas.filter((c) => c.dias > DIAS_SIN_RESPUESTA).sort((a, b) => b.importeAsta - a.importeAsta);
  return {
    tareas: sin.slice(0, POR_GRUPO).map((c) => ({
      clave: `cot-${c.id}`,
      cliente: c.cliente,
      partnerId: c.partnerId,
      motivo: 'Cotización sin respuesta',
      tono: 'alerta' as const,
      detalle: `${c.folio}, de hace ${cuantos(c.dias, 'día', 'días')}: ${moneyEntero(c.importeAsta)} en ASTA.`,
      accion: { texto: 'Ver cotización', href: `/cotizaciones/${c.id}` },
    })),
    total: r.totales.sinRespuesta,
    todas: { texto: 'Ver todas las cotizaciones', href: '/cotizaciones' },
  };
}

async function programa(token: string): Promise<[Grupo, Grupo]> {
  const r = await intentar(() => getProgramaCartera(token));
  if (!r) throw new Error('programa');
  const bajan = r.clientes.filter((c) => c.evaluacion.nivel !== 'GENERAL' && alCerrar(c.evaluacion) === 'baja');
  // En juego: primero a los que menos les falta del trimestre, que son las llamadas que más rinden.
  const falta = (c: (typeof r.clientes)[number]) => c.evaluacion.cuotaTrimestral - c.evaluacion.compraTrimestre;
  const juego = r.clientes.filter((c) => alCerrar(c.evaluacion) === 'juego' && subir(c.evaluacion.nivel) !== c.evaluacion.nivel).sort((a, b) => falta(a) - falta(b));
  return [
    {
      tareas: bajan.slice(0, POR_GRUPO).map((c) => ({
        clave: `baja-${c.clave}`,
        cliente: c.nombre,
        partnerId: c.partnerId,
        motivo: `Baja de ${reglaDe(c.evaluacion.nivel).nombre}`,
        tono: 'alerta' as const,
        detalle: `Ya falló un obligatorio del trimestre: en enero pasa a ${reglaDe(bajar(c.evaluacion.nivel)).nombre}.`,
        accion: { texto: 'Ver ficha', href: `/cartera/${c.partnerId}` },
      })),
      total: bajan.length,
      todas: { texto: 'Ver todos los que bajan', href: '/categorias?ver=bajan' },
    },
    {
      tareas: juego.slice(0, POR_GRUPO).map((c) => ({
        clave: `juego-${c.clave}`,
        cliente: c.nombre,
        partnerId: c.partnerId,
        motivo: `Puede subir a ${reglaDe(subir(c.evaluacion.nivel)).nombre}`,
        tono: 'oportunidad' as const,
        detalle: `Le falta: ${loQueLeFalta(c.evaluacion) || 'cerrar el trimestre cumpliendo'}.`,
        accion: { texto: 'Ver ficha', href: `/cartera/${c.partnerId}` },
      })),
      total: juego.length,
      todas: { texto: 'Ver todos los que están en juego', href: '/categorias?ver=juego' },
    },
  ];
}

async function enfriando(token: string): Promise<Grupo> {
  const [act, port] = await Promise.all([intentar(() => getActividadCartera(token)), intentar(() => getPortfolio(token))]);
  if (!act || !port) throw new Error('actividad');
  const nombres = new Map(port.filas.map((f) => [f.id, f.nombre]));
  // Primero los que más compraban: perderlos es lo que más cuesta.
  const lista = act.data.filter((a) => (a.estado === 'en_riesgo' || a.estado === 'dormido') && a.facturado12m > 0).sort((a, b) => b.facturado12m - a.facturado12m);
  return {
    tareas: lista.slice(0, POR_GRUPO).map((a) => ({
      clave: `frio-${a.partnerId}`,
      cliente: nombres.get(a.partnerId) ?? `Cliente ${a.partnerId}`,
      partnerId: a.partnerId,
      motivo: 'Se está enfriando',
      tono: 'pendiente' as const,
      detalle: `${a.diasSinComprar === null ? 'Sin compras recientes' : `${n(a.diasSinComprar)} días sin comprar ASTA`}; en 12 meses compró ${moneyEntero(a.facturado12m)}.`,
      accion: { texto: 'Ver ficha', href: `/cartera/${a.partnerId}` },
    })),
    total: lista.length,
    todas: { texto: 'Ver tu cartera', href: '/cartera' },
  };
}

async function impulsa(token: string): Promise<Grupo> {
  const r = await intentar(() => getImpulsa(token));
  if (!r) throw new Error('impulsa');
  // Los que más compran en originales, primero; la cifra no se enseña (solo montos de ASTA).
  const lista = r.data
    .map((c) => ({ ...c, pendientes: c.sugerencias.filter((s) => s.visible).length }))
    .filter((c) => c.pendientes > 0)
    .sort((a, b) => b.enJuego - a.enJuego);
  return {
    tareas: lista.slice(0, POR_GRUPO).map((c) => ({
      clave: `imp-${c.partnerId}`,
      cliente: c.nombre,
      partnerId: c.partnerId,
      motivo: 'Pasar a ASTA',
      tono: 'oportunidad' as const,
      detalle: `Compra ${cuantos(c.pendientes, 'producto original que tiene', 'productos originales que tienen')} su ASTA.`,
      accion: { texto: 'Ver sugerencias', href: '/impulsa' },
    })),
    total: lista.length,
    todas: { texto: 'Ver todas las sugerencias', href: '/impulsa' },
  };
}

export async function TareasVendedor({ token }: { token: string }) {
  const lecturas = await Promise.allSettled([pedidos(token), cotizaciones(token), programa(token), enfriando(token), impulsa(token)]);
  const fallidas = lecturas.filter((l) => l.status === 'rejected').length;
  const grupos = lecturas.flatMap((l) => (l.status === 'fulfilled' ? [l.value].flat() : [])).filter((g) => g.tareas.length > 0);
  const total = grupos.reduce((s, g) => s + g.total, 0);

  return (
    <section className="panel dash-hoy" aria-labelledby="hoy-titulo">
      <div className="dash-cabeza">
        <h2 id="hoy-titulo">Para hoy</h2>
        {total > 0 && <span className="atencion-cuenta">{n(total)}</span>}
      </div>
      <p className="panel-nota">A quién llamar y para qué, lo más urgente primero.</p>
      {grupos.length === 0 ? (
        <div className="empty">{fallidas ? 'Nada pendiente en lo que se pudo leer.' : 'Todo al día: nadie te espera hoy.'}</div>
      ) : (
        <ul className="tareas-lista">
          {grupos.map((g) => (
            <li key={g.tareas[0]!.clave} className="tareas-grupo">
              <ul>
                {g.tareas.map((t) => (
                  <li key={t.clave} className={`tarea tarea-${t.tono}`}>
                    <span className="atencion-punto" aria-hidden="true" />
                    <span className="tarea-texto">
                      <span className="tarea-cabeza">
                        <Link href={`/cartera/${t.partnerId}`} className="tarea-cliente" data-privado>
                          {t.cliente}
                        </Link>
                        <span className="tarea-motivo">{t.motivo}</span>
                      </span>
                      <span className="tarea-detalle">{t.detalle}</span>
                    </span>
                    <Link href={t.accion.href} className="btn btn-inline tarea-accion">
                      {t.accion.texto}
                    </Link>
                  </li>
                ))}
              </ul>
              {g.total > g.tareas.length && g.todas && (
                <Link href={g.todas.href} className="dash-mas tareas-mas">
                  {g.todas.texto} ({n(g.total)}) →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {fallidas > 0 && <p className="panel-nota">{cuantos(fallidas, 'parte no se pudo leer', 'partes no se pudieron leer')} ahora.</p>}
    </section>
  );
}
