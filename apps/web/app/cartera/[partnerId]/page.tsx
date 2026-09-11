import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PaymentState } from '@asta/shared-types';
import { PAYMENT_STATE_LABEL } from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { getClientInvoicing, ApiError, ContractError } from '@/lib/api';
import { money, fecha } from '@/lib/formato';
import { GraficaMensual } from './GraficaMensual';

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
  try {
    datos = await getClientInvoicing(sesion.odooUserId, partnerId, {
      serieMensual: true,
      desde,
      hasta,
      incluirNotasDeCredito: nc === '1',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();

    // 403: el cliente existe pero no es de este vendedor. Se dice tal cual —
    // ocultarlo detrás de un 404 genérico solo confunde a quien se equivocó de
    // enlace, y el intento ya quedó registrado en audit_logs del middleware.
    const esPermiso = error instanceof ApiError && error.status === 403;
    const esContrato = error instanceof ContractError;

    return (
      <Marco nombre={sesion.nombre}>
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
    <Marco nombre={sesion.nombre}>
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

function Marco({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <>
      <div className="dev-banner">
        Sesión de desarrollo sin contraseña · autenticación real en los issues <code>#51</code> y{' '}
        <code>#52</code>
      </div>
      <header className="topbar">
        <div className="brand">
          <Link href="/cartera" style={{ color: 'inherit' }}>
            ASTA
          </Link>
          <span>Panel de vendedores</span>
        </div>
        <div className="topbar-right">
          <span className="who">
            <strong>{nombre}</strong>
          </span>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}
