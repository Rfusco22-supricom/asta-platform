import Link from 'next/link';
import { DIAS_SIN_RESPUESTA, MAX_COTIZACIONES, type Cotizaciones, type EstadoCotizacion, type SedeId } from '@asta/shared-types';
import { Cifra } from '@/components/Cifras';
import { CargandoEnlace } from '@/components/CargandoEnlace';
import { urlCon } from '@/components/Sedes';
import { moneyCompact, moneyEntero } from '@/lib/formato';
import { nombrePeriodo } from '@/lib/meses';

/**
 * Las cotizaciones de ASTA, para el administrador (toda la empresa) y para el
 * vendedor (su cartera): cuatro cifras del periodo, una pestaña por estado y la
 * lista. Contrato y reglas en `@asta/shared-types` (`cotizaciones.ts`).
 *
 * Las abiertas salen de la más antigua a la más nueva: arriba lo que lleva más
 * tiempo esperando respuesta, que es a quien hay que llamar primero.
 */

const n = (x: number) => x.toLocaleString('es-VE');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «2026-10-28» → «28 oct 2026», sin pasar por zonas horarias: ya viene en el día de Caracas. */
function dia(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
}

const PESTANAS: Array<{ estado: EstadoCotizacion; titulo: string }> = [
  { estado: 'abierta', titulo: 'Abiertas' },
  { estado: 'confirmada', titulo: 'Confirmadas' },
  { estado: 'cancelada', titulo: 'Canceladas' },
];

const VACIO: Record<EstadoCotizacion, string> = {
  abierta: 'No hay cotizaciones abiertas en el periodo: todas se confirmaron o se cancelaron.',
  confirmada: 'Ninguna cotización del periodo se ha confirmado todavía.',
  cancelada: 'No se canceló ninguna cotización en el periodo.',
};

/** La URL de la pantalla con su periodo, su sede y el estado. */
function urlEstado(base: string, periodo: { desde: string; hasta: string }, sede: SedeId | null, estado: EstadoCotizacion): string {
  const url = urlCon(base, { periodo, sede });
  return estado === 'abierta' ? url : `${url}${url.includes('?') ? '&' : '?'}estado=${estado}`;
}

export function estadoDeParams(params: Record<string, string | string[] | undefined>): EstadoCotizacion {
  const e = params.estado;
  return e === 'confirmada' || e === 'cancelada' ? e : 'abierta';
}

export function ListaCotizaciones({
  datos,
  base,
  periodo,
  sede = null,
  conVendedor,
}: {
  datos: Cotizaciones;
  base: string;
  periodo: { desde: string; hasta: string };
  sede?: SedeId | null;
  /** El administrador ve quién la hizo; el vendedor, que son todas suyas, no. */
  conVendedor: boolean;
}) {
  const { totales, estado, filas } = datos;
  const cuantas = totales.abierta.cotizaciones + totales.confirmada.cotizaciones + totales.cancelada.cotizaciones;
  const cotizado = totales.abierta.importeAsta + totales.confirmada.importeAsta + totales.cancelada.importeAsta;
  const conversion = cuantas > 0 ? totales.confirmada.cotizaciones / cuantas : null;
  const enPeriodo = nombrePeriodo(periodo.desde, periodo.hasta);
  const enLaPestana = totales[estado].cotizaciones;

  return (
    <>
      <section className="stats">
        <Cifra icono="ticket" etiqueta="Cotizado en ASTA" valor={moneyCompact(cotizado)} nota={`${n(cuantas)} cotizaciones en ${enPeriodo}`} />
        <Cifra
          icono="diana"
          color="verde"
          etiqueta="Conversión"
          valor={conversion === null ? '—' : `${Math.round(conversion * 100)} %`}
          nota={`${n(totales.confirmada.cotizaciones)} de ${n(cuantas)} ya son pedido`}
        />
        <Cifra
          icono="caja"
          color="violeta"
          etiqueta="Abiertas"
          valor={moneyCompact(totales.abierta.importeAsta)}
          nota={`${n(totales.abierta.cotizaciones)} sin confirmar ni cancelar`}
        />
        <Cifra
          icono="reloj"
          color="ambar"
          etiqueta="Sin respuesta"
          valor={n(totales.sinRespuesta)}
          nota={`abiertas hace más de ${DIAS_SIN_RESPUESTA} días`}
          tono={totales.sinRespuesta > 0 ? 'atencion' : undefined}
        />
      </section>

      <section className="panel">
        <nav className="pi-vistas cat-filtros" aria-label="Qué cotizaciones ver">
          {PESTANAS.map((p) => (
            <Link key={p.estado} href={urlEstado(base, periodo, sede, p.estado)} aria-current={p.estado === estado ? 'page' : undefined}>
              {p.titulo}
              <span className="pi-cuenta">{n(totales[p.estado].cotizaciones)}</span>
              <CargandoEnlace />
            </Link>
          ))}
        </nav>

        {filas.length === 0 ? (
          <div className="empty">{VACIO[estado]}</div>
        ) : (
          <div className="table-wrap">
            <table className="tabla-tarjetas tabla-cotizaciones">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Cotización</th>
                  {conVendedor && <th>Vendedor</th>}
                  <th className="num">ASTA</th>
                  <th className="num">Total</th>
                  <th>{estado === 'abierta' ? 'Espera' : 'Creada'}</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => {
                  const vencida = c.vence !== null && c.vence < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={c.id}>
                      <td className="c-cliente">
                        <Link href={`/cartera/${c.partnerId}`} className="cliente-nombre enlace-ficha">
                          {c.cliente}
                        </Link>
                      </td>
                      <td data-etiqueta="Cotización">
                        <span className="cot-folio">{c.folio}</span>
                        <span className="stat-sub">{dia(c.fecha)}</span>
                      </td>
                      {conVendedor && <td data-etiqueta="Vendedor">{c.vendedor ?? <span className="stat-sub">sin vendedor</span>}</td>}
                      <td className="num" data-etiqueta="ASTA">
                        {moneyEntero(c.importeAsta)}
                      </td>
                      <td className="num" data-etiqueta="Total">
                        {moneyEntero(c.importeTotal)}
                      </td>
                      <td data-etiqueta={estado === 'abierta' ? 'Espera' : 'Creada'}>
                        {estado === 'abierta' ? (
                          <>
                            <span className={c.dias > DIAS_SIN_RESPUESTA ? 'cot-espera cot-espera-larga' : 'cot-espera'}>
                              {c.dias === 0 ? 'hoy' : c.dias === 1 ? '1 día' : `${n(c.dias)} días`}
                            </span>
                            {c.vence && <span className={vencida ? 'stat-sub cot-vencida' : 'stat-sub'}>{vencida ? `venció el ${dia(c.vence)}` : `vale hasta el ${dia(c.vence)}`}</span>}
                          </>
                        ) : (
                          <span className="stat-sub">{c.dias === 0 ? 'hoy' : c.dias === 1 ? 'hace 1 día' : `hace ${n(c.dias)} días`}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {enLaPestana > filas.length && (
          <p className="panel-nota cot-pie">
            Se muestran las {n(MAX_COTIZACIONES)} {estado === 'abierta' ? 'más antiguas' : 'más recientes'} de {n(enLaPestana)}. Elige un periodo más corto para ver el resto.
          </p>
        )}
        <p className="panel-nota cot-pie">
          Pedidos de venta de Odoo con algún producto ASTA, creados en {enPeriodo}. «ASTA» es lo de la marca, sin IVA; «Total», el pedido entero.
        </p>
      </section>
    </>
  );
}
