import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { PaymentState } from '@asta/shared-types';
import { PAYMENT_STATE_LABEL } from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import {
  getClientInvoicing,
  getClientProfile,
  getDuplicados,
  ApiError,
  esRedireccion,
  ContractError,
} from '@/lib/api';
import { money, fecha } from '@/lib/formato';
import { GraficaMensual } from './GraficaMensual';
import { Perfil } from './Perfil';

/**
 * Ficha de cliente.
 *
 * Server Component: el rango de fechas viaja por query string, así que cambiar
 * el filtro es una navegación normal. Sin estado en el cliente, sin JavaScript
 * para esto, y el enlace con un rango aplicado se puede compartir tal cual.
 */

export const dynamic = 'force-dynamic';

const ODOO_URL = process.env.ODOO_URL ?? '';

/** Colores por estado: el saldo pendiente debe cantar a la vista. */
const ESTADO_CLASE: Record<string, string> = {
  paid: 'positive',
  in_payment: 'neutral',
  partial: 'warning',
  not_paid: 'danger',
  reversed: 'neutral',
  invoicing_legacy: 'neutral',
  desconocido: 'neutral',
};

interface Props {
  params: Promise<{ partnerId: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string; nc?: string }>;
}

export default async function FichaCliente({ params, searchParams }: Props) {
  const sesion = await requireSession();
  const { partnerId: raw } = await params;
  const { desde, hasta, nc } = await searchParams;

  const partnerId = Number(raw);
  if (!Number.isInteger(partnerId) || partnerId <= 0) notFound();

  let datos;
  let duplicados: Awaited<ReturnType<typeof getDuplicados>> | null = null;
  let perfil = null;
  try {
    // En paralelo: son dos endpoints independientes y encadenarlos duplicaria
    // la espera de una pantalla que ya tarda ~2 s contra Odoo.
    //
    // El perfil se degrada solo: si falla, la ficha sigue mostrando la
    // facturacion, que es lo esencial. Perder el top de productos no justifica
    // dejar al vendedor sin la pantalla entera.
    const [inv, prof, dup] = await Promise.all([
      getClientInvoicing(sesion.accessToken, partnerId, {
        serieMensual: true,
        desde,
        hasta,
        incluirNotasDeCredito: nc === '1',
      }),
      getClientProfile(sesion.accessToken, partnerId).catch(() => null),
      // Se degrada solo, igual que el perfil: el aviso de duplicados es
      // importante, pero no vale dejar sin ficha a nadie si Odoo tarda.
      getDuplicados(sesion.accessToken, partnerId).catch(() => null),
    ]);
    datos = inv;
    perfil = prof;
    duplicados = dup;
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga y
    // el usuario ve "no se pudo cargar" en vez de ir al login.
    if (esRedireccion(error)) throw error;
    if (error instanceof ApiError && error.status === 404) notFound();

    // 403: el cliente existe pero no es de este vendedor. Se dice tal cual —
    // ocultarlo detrás de un 404 genérico solo confunde a quien se equivocó de
    // enlace, y el intento ya quedó registrado en audit_logs del middleware.
    const esPermiso = error instanceof ApiError && error.status === 403;
    const esContrato = error instanceof ContractError;

    return (
      <Marco usuario={sesion.usuario} titulo="Cliente">
        <div className="notice error">
          <h2>
            {esPermiso
              ? 'Este cliente no está en tu cartera'
              : esContrato
                ? 'El panel y la API no se entienden'
                : 'No se pudieron cargar los datos'}
          </h2>
          <p>{error instanceof Error ? error.message : 'Error inesperado.'}</p>
          <p style={{ marginTop: 12 }}>
            <Link href="/cartera">← Volver a mi cartera</Link>
          </p>
        </div>
      </Marco>
    );
  }

  const { cliente, facturacion: f } = datos;
  const nombre = cliente.nombre ?? `Cliente ${partnerId}`;
  const pctCobrado = f.totalFacturado > 0 ? (f.cobrado / f.totalFacturado) * 100 : 0;
  const hayFiltro = Boolean(desde || hasta || nc === '1');

  return (
    <Marco usuario={sesion.usuario} titulo={nombre}>
      <div className="page-head">
        <div className="crumb">
          <Link href="/cartera">Mi cartera</Link> <span>/</span> {nombre}
        </div>
        <h1>{nombre}</h1>
        <p>
          {cliente.tier ?? 'Sin tarifa asignada'}
          {ODOO_URL && (
            <>
              {' · '}
              <a
                className="enlace-accion"
                href={`${ODOO_URL}/web#id=${partnerId}&model=res.partner&view_type=form`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir en Odoo ↗
              </a>
            </>
          )}
        </p>
      </div>

      {/*
        ── El número de esta ficha puede estar incompleto (#50) ──────────────

        El 34,5 % de lo facturado en la instancia está repartido entre registros
        duplicados del mismo cliente. Los totales de abajo son EXACTOS para este
        registro y aun así un retrato falso del cliente cuando hay hermanos.

        Va arriba del todo y antes de las cifras a propósito: un aviso debajo de
        los números llega tarde: para entonces ya se ha leído la cifra y se ha
        creído.

        Solo aparece si hay hermanos CON facturación. De los 272 grupos
        duplicados, 133 no distorsionan nada y avisar de ellos sería ruido en
        media cartera.
      */}
      {duplicados && duplicados.hermanos.length > 0 && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <h2>
            Este cliente tiene {duplicados.hermanos.length}{' '}
            {duplicados.hermanos.length === 1 ? 'registro más' : 'registros más'} en Odoo
          </h2>
          <p>
            Lo que ves aquí es <strong>{money(duplicados.esteRegistro)}</strong> de{' '}
            <strong>{money(duplicados.total)}</strong> facturados al cliente real. El resto
            está en:
          </p>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13.5 }}>
            {duplicados.hermanos.map((h) => (
              <li key={h.partnerId} style={{ marginBottom: 4 }}>
                <strong>{money(h.facturado)}</strong> en {h.facturas}{' '}
                {h.facturas === 1 ? 'factura' : 'facturas'}
                {h.vendedorNombre && <> · cartera de {h.vendedorNombre}</>}
                {ODOO_URL && (
                  <>
                    {' · '}
                    <a
                      className="enlace-accion"
                      href={`${ODOO_URL}/web#id=${h.partnerId}&model=res.partner&view_type=form`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ver en Odoo
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-3)' }}>
            Se detectan por {duplicados.hermanos[0].motivo === 'rif' ? 'RIF' : 'nombre'} idéntico.
            Unirlos se hace en Odoo (Contactos → Acción → Fusionar), y mueve la facturación de
            una cartera a otra: no es una decisión del panel.
          </p>
        </div>
      )}

      {/* ── Filtros ────────────────────────────────────────────────────────── */}
      <form className="filtros" method="get">
        <div className="filtro-campo">
          <label htmlFor="desde">Desde</label>
          <input id="desde" name="desde" type="date" className="input" defaultValue={desde ?? ''} />
        </div>
        <div className="filtro-campo">
          <label htmlFor="hasta">Hasta</label>
          <input id="hasta" name="hasta" type="date" className="input" defaultValue={hasta ?? ''} />
        </div>
        <label className="check">
          <input type="checkbox" name="nc" value="1" defaultChecked={nc === '1'} />
          Restar notas de crédito
        </label>
        <button type="submit" className="btn btn-inline">
          Aplicar
        </button>
        {hayFiltro && (
          <Link href={`/cartera/${partnerId}`} className="btn-link">
            Quitar filtros
          </Link>
        )}
      </form>

      {hayFiltro && (
        <p className="filtro-aviso">
          Mostrando {desde ? `desde ${fecha(desde)}` : 'desde el inicio'}{' '}
          {hasta ? `hasta ${fecha(hasta)}` : 'hasta hoy'}
          {nc === '1' ? ', netas de notas de crédito' : ''}.
        </p>
      )}

      {/* ── Resumen ───────────────────────────────────────────────────────── */}
      <section className="stats">
        <div className="stat">
          <div className="stat-label">Total facturado</div>
          <div className="stat-value">{money(f.totalFacturado)}</div>
          <div className="stat-sub">
            {f.numeroFacturas} {f.numeroFacturas === 1 ? 'factura' : 'facturas'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Por cobrar</div>
          <div className="stat-value" style={{ color: f.porCobrar > 0 ? 'var(--danger)' : undefined }}>
            {money(f.porCobrar)}
          </div>
          <div className="stat-sub">{pctCobrado.toFixed(0)} % cobrado</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ticket promedio</div>
          <div className="stat-value small">{money(f.ticketPromedio)}</div>
          <div className="stat-sub">por factura</div>
        </div>
        <div className="stat">
          <div className="stat-label">Última factura</div>
          <div className="stat-value small">
            {f.ultimaFactura ? money(f.ultimaFactura.monto) : '—'}
          </div>
          <div className="stat-sub">
            {f.ultimaFactura
              ? `${f.ultimaFactura.folio} · ${fecha(f.ultimaFactura.fecha)}`
              : 'sin facturas'}
          </div>
        </div>
      </section>

      {perfil && <Perfil perfil={perfil} />}

      {/* ── Serie mensual ─────────────────────────────────────────────────── */}
      <section className="panel">
        <h2>Evolución mensual</h2>
        <GraficaMensual puntos={f.serieMensual ?? []} />
      </section>

      {/* ── Estado de pago ────────────────────────────────────────────────── */}
      <section className="panel">
        <h2>Estado de cobro</h2>

        {f.desglosePorEstadoDePago.length === 0 ? (
          <div className="empty" style={{ padding: '28px 20px' }}>
            Sin facturas en el periodo.
          </div>
        ) : (
          <>
            {/* Una barra proporcional: se entiende antes que la tabla. */}
            <div className="barra-estados" role="presentation">
              {f.desglosePorEstadoDePago
                .filter((d) => d.monto > 0)
                .map((d) => (
                  <div
                    key={d.estado}
                    className={`segmento ${ESTADO_CLASE[d.estado] ?? 'neutral'}`}
                    style={{ flexGrow: d.monto }}
                    title={`${PAYMENT_STATE_LABEL[d.estado as PaymentState]}: ${money(d.monto)}`}
                  />
                ))}
            </div>

            <div className="table-wrap" style={{ border: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th className="num">Facturado</th>
                    <th className="num">Saldo</th>
                    <th className="num">Facturas</th>
                  </tr>
                </thead>
                <tbody>
                  {f.desglosePorEstadoDePago.map((d) => (
                    <tr key={d.estado}>
                      <td>
                        <span className={`punto ${ESTADO_CLASE[d.estado] ?? 'neutral'}`} />
                        {PAYMENT_STATE_LABEL[d.estado as PaymentState] ?? d.estado}
                      </td>
                      <td className="num">{money(d.monto)}</td>
                      <td className={`num ${d.saldo > 0 ? 'debt' : 'zero'}`}>
                        {d.saldo === 0 ? '—' : money(d.saldo)}
                      </td>
                      <td className="num">{d.facturas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </Marco>
  );
}

