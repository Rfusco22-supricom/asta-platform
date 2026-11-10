import Link from 'next/link';
import { DIAS_SIN_RESPUESTA, reglaDe, type ClaveCategoria } from '@asta/shared-types';
import {
  getAgentes,
  getCalidadDatos,
  getCotizacionesEmpresa,
  getDuplicadosInforme,
  getEstadisticasRecomendador,
  getKioscos,
  getLoteAsta,
  getLoteFabricante,
  getPedidosParaAtender,
  getProgramaEmpresa,
  getSinAcceso,
} from '@/lib/api';
import { fechasDe } from '@/components/Periodos';
import { alCerrar } from '@/components/ProgramaStaff';
import { moneyCompact } from '@/lib/formato';
import { intentar, n } from './Tablero';

/**
 * «Necesita tu atención»: lo que hay por hacer en todo el panel, en una lista,
 * lo urgente primero. Sustituye a la pantalla Pendientes, que obligaba a entrar
 * para enterarse.
 *
 * Solo sale lo que NO está al día: una fila es una tarea, con el sitio donde se
 * resuelve. Cada lectura va por su cuenta (`intentar`): si una falla, esa fila
 * no sale y las demás sí; al pie se dice cuántas no se pudieron leer.
 *
 * Urgente (rojo) es lo que pierde una venta o un cliente si se deja: pedidos y
 * cotizaciones que esperan, clientes que ya bajan de nivel, errores de Odoo que
 * mueven dinero, tablets apagadas. Pendiente (ámbar), lo que conviene hacer.
 */

type Estado = 'alerta' | 'pendiente';

interface Tarea {
  estado: Estado;
  titulo: string;
  detalle: string;
  href: string;
  /** El detalle nombra clientes o tablets: el modo presentación lo tapa. */
  privado?: boolean;
}

const cuantos = (x: number, uno: string, varios: string) => `${n(x)} ${x === 1 ? uno : varios}`;
const dias = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

async function pedidos(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getPedidosParaAtender(token, 'empresa'));
  if (!r) throw new Error('pedidos');
  if (r.length === 0) return null;
  const masViejo = Math.max(...r.map((p) => dias(p.enviadoEn)));
  return {
    estado: 'alerta',
    titulo: `${cuantos(r.length, 'pedido sugerido', 'pedidos sugeridos')} de clientes sin atender`,
    detalle: masViejo === 0 ? 'Llegaron hoy.' : `El más antiguo, de hace ${cuantos(masViejo, 'día', 'días')}.`,
    href: '/admin/cotizaciones',
  };
}

async function cotizaciones(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getCotizacionesEmpresa(token, fechasDe('12m'), 'abierta'));
  if (!r) throw new Error('cotizaciones');
  const sin = r.totales.sinRespuesta;
  if (sin === 0) return null;
  return {
    estado: 'alerta',
    titulo: `${cuantos(sin, 'cotización', 'cotizaciones')} sin respuesta hace más de ${DIAS_SIN_RESPUESTA} días`,
    detalle: `Abiertas en total: ${n(r.totales.abierta.cotizaciones)}, con ${moneyCompact(r.totales.abierta.importeAsta)} en ASTA.`,
    href: '/admin/cotizaciones',
  };
}

/** Los que ya fallaron un obligatorio del trimestre: bajan un nivel al cerrarlo, pase lo que pase. */
async function bajanDeNivel(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getProgramaEmpresa(token));
  if (!r) throw new Error('programa');
  const bajan = r.clientes.filter((c) => c.evaluacion.nivel !== 'GENERAL' && alCerrar(c.evaluacion) === 'baja');
  if (bajan.length === 0) return null;
  const porNivel = new Map<ClaveCategoria, number>();
  for (const c of bajan) porNivel.set(c.evaluacion.nivel, (porNivel.get(c.evaluacion.nivel) ?? 0) + 1);
  const desglose = (['DIAMANTE', 'ORO', 'PLATA', 'BRONCE'] as const)
    .filter((k) => porNivel.get(k))
    .map((k) => `${n(porNivel.get(k)!)} de ${reglaDe(k).nombre}`)
    .join(', ');
  return {
    estado: 'alerta',
    titulo: `${cuantos(bajan.length, 'cliente baja', 'clientes bajan')} de nivel al cerrar el trimestre`,
    detalle: `Ya fallaron un obligatorio: ${desglose}.`,
    href: '/admin/categorias?ver=bajan',
  };
}

async function porValidar(token: string): Promise<Tarea | null> {
  const [fab, asta, orig] = await Promise.all([
    intentar(() => getLoteFabricante(token)),
    intentar(() => getLoteAsta(token, 'ASTA')),
    intentar(() => getLoteAsta(token, 'ORIGINAL')),
  ]);
  if (!fab && !asta && !orig) throw new Error('compatibilidades');
  const f = fab?.propuestas ?? 0;
  const total = f + (asta?.data.length ?? 0) + (orig?.data.length ?? 0);
  if (total === 0) return null;
  return {
    estado: 'pendiente',
    titulo: `${cuantos(total, 'compatibilidad lista', 'compatibilidades listas')} para validar`,
    detalle: 'Hasta validarlas, la aplicación ASTA no ofrece esos cartuchos.',
    href: f > 0 ? '/admin/compatibilidades/impresoras' : '/admin/compatibilidades',
  };
}

async function tablets(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getKioscos(token));
  if (!r) throw new Error('tablets');
  const dia = Date.now() - 86_400_000;
  const calladas = r.data.filter((k) => k.activo && (!k.ultimaConexion || new Date(k.ultimaConexion).getTime() < dia));
  if (calladas.length === 0) return null;
  return {
    estado: 'alerta',
    titulo: `${cuantos(calladas.length, 'tablet', 'tablets')} sin conectarse en 24 horas`,
    detalle: calladas.map((k) => k.nombre).join(', '),
    href: '/admin/kioscos',
    privado: true,
  };
}

async function calidad(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getCalidadDatos(token));
  if (!r) throw new Error('calidad');
  const de = (g: string) => r.revisiones.filter((x) => x.gravedad === g).reduce((s, x) => s + x.total, 0);
  const alta = de('alta');
  const media = de('media');
  if (alta + media === 0) return null;
  return {
    estado: alta > 0 ? 'alerta' : 'pendiente',
    titulo: `${cuantos(alta + media, 'error', 'errores')} en los datos de Odoo`,
    detalle: `${n(alta)} ${alta === 1 ? 'mueve' : 'mueven'} dinero y ${n(media)} ${media === 1 ? 'rompe' : 'rompen'} algo del panel.`,
    href: '/admin/calidad',
  };
}

async function duplicados(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getDuplicadosInforme(token));
  if (!r) throw new Error('duplicados');
  const { partidos, montoPartido } = r.resumen;
  if (partidos === 0) return null;
  return {
    estado: 'pendiente',
    titulo: `${cuantos(partidos, 'cliente', 'clientes')} con la facturación repartida en varias fichas`,
    detalle: `${moneyCompact(montoPartido)} repartidos: hay que fusionarlas en Odoo.`,
    href: '/admin/duplicados',
  };
}

async function accesos(token: string): Promise<Tarea[]> {
  const [sin, agentes] = await Promise.all([intentar(() => getSinAcceso(token, 1)), intentar(() => getAgentes(token))]);
  if (!sin && !agentes) throw new Error('accesos');
  const tareas: Tarea[] = [];
  const vendedores = agentes?.totales.sinAcceso ?? 0;
  const clientes = sin?.total ?? 0;
  if (vendedores > 0) {
    tareas.push({ estado: 'alerta', titulo: `${cuantos(vendedores, 'vendedor', 'vendedores')} sin acceso al panel`, detalle: 'No pueden ver su cartera ni sus tareas.', href: '/admin/agentes' });
  }
  if (clientes > 0) {
    tareas.push({ estado: 'pendiente', titulo: `${cuantos(clientes, 'cliente', 'clientes')} sin invitar al panel`, detalle: 'Clientes de Odoo que aún no tienen cuenta en el panel.', href: '/admin/usuarios' });
  }
  return tareas;
}

async function sinResultado(token: string): Promise<Tarea | null> {
  const r = await intentar(() => getEstadisticasRecomendador(token, fechasDe('trimestre')));
  if (!r) throw new Error('busquedas');
  const { busquedas, sinResultado: sin } = r.totales;
  if (sin === 0) return null;
  return {
    estado: 'pendiente',
    titulo: `${cuantos(sin, 'búsqueda', 'búsquedas')} en la aplicación sin resultado`,
    detalle: `De ${n(busquedas)} en los últimos tres meses. Un alias las resuelve.`,
    href: '/admin/recomendador',
  };
}

export async function Atencion({ token }: { token: string }) {
  const lecturas = await Promise.allSettled([
    pedidos(token),
    cotizaciones(token),
    bajanDeNivel(token),
    tablets(token),
    calidad(token),
    accesos(token),
    porValidar(token),
    duplicados(token),
    sinResultado(token),
  ]);
  const fallidas = lecturas.filter((l) => l.status === 'rejected').length;
  const tareas = lecturas
    .flatMap((l) => (l.status === 'fulfilled' ? [l.value] : []))
    .flat()
    .filter((t): t is Tarea => t !== null)
    // Estable: dentro de cada color, el orden de arriba.
    .sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'alerta' ? -1 : 1));

  return (
    <section className="panel dash-atencion" aria-labelledby="atencion-titulo">
      <div className="dash-cabeza">
        <h2 id="atencion-titulo">Necesita tu atención</h2>
        {tareas.length > 0 && <span className="atencion-cuenta">{n(tareas.length)}</span>}
      </div>
      {tareas.length === 0 ? (
        <div className="empty">{fallidas ? 'Nada pendiente en lo que se pudo leer.' : 'Todo al día.'}</div>
      ) : (
        <ul className="atencion-lista">
          {tareas.map((t) => (
            <li key={t.titulo}>
              <Link href={t.href} className={`atencion-${t.estado}`}>
                <span className="atencion-punto" aria-hidden="true" />
                <span className="atencion-texto">
                  <strong>{t.titulo}</strong>
                  <span data-privado={t.privado || undefined}>{t.detalle}</span>
                </span>
                <span className="sr-only">{t.estado === 'alerta' ? '(urgente)' : '(pendiente)'}</span>
                <span className="atencion-flecha" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {fallidas > 0 && <p className="panel-nota">{cuantos(fallidas, 'comprobación no se pudo leer', 'comprobaciones no se pudieron leer')} ahora.</p>}
    </section>
  );
}
