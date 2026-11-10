import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { Cifra } from '@/components/Cifras';
import { getFacturasCliente, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { fecha, money } from '@/lib/formato';
import { DIAS_VENCE_PRONTO, FACTURAS_POR_PAGINA, PAYMENT_STATE_LABEL, type PublicInvoice, type VistaFacturas } from '@asta/shared-types';

/**
 * «Mis facturas»: lo que el cliente debe de ASTA, lo que vence pronto y sus
 * facturas con ASTA, con el PDF. Solo montos de ASTA (decidido con Supricom el
 * 2026-11-10): de cada factura, la parte ASTA de su total y de su saldo. Por
 * defecto, las pendientes, de la que vence antes a la que vence después.
 */

export const dynamic = 'force-dynamic';

/** Hoy en Caracas, `YYYY-MM-DD`. */
function hoyCaracas(): string {
  return new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** «vencida hace 3 días», «vence hoy», «vence en 5 días»; nada si ya está pagada. */
function cuandoVence(f: PublicInvoice, hoy: string): { texto: string; tono: 'vencida' | 'pronto' | null } | null {
  if (!f.vencimiento || f.saldo <= 0 || f.estadoPago === 'in_payment') return null;
  const d = diasEntre(hoy, f.vencimiento);
  if (d < 0) return { texto: `vencida hace ${-d} ${d === -1 ? 'día' : 'días'}`, tono: 'vencida' };
  if (d === 0) return { texto: 'vence hoy', tono: 'pronto' };
  return { texto: `vence en ${d} ${d === 1 ? 'día' : 'días'}`, tono: d <= DIAS_VENCE_PRONTO ? 'pronto' : null };
}

export default async function FacturasPage({ searchParams }: { searchParams: Promise<{ vista?: string; pagina?: string; elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Ver su panel»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo="Mis facturas">
        <ElegirCliente token={sesion.accessToken} destino="/cuenta/facturas" />
      </Marco>
    );
  }
  const cliente = comoCliente?.id ?? null;
  const q = await searchParams;
  const vista: VistaFacturas = q.vista === 'todas' ? 'todas' : 'pendientes';
  const pagina = Math.max(1, Number(q.pagina) || 1);

  let d;
  try {
    d = await getFacturasCliente(sesion.accessToken, vista, pagina, cliente);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Mis facturas">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudieron leer tus facturas'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }

  const r = d.resumen;
  const hoy = hoyCaracas();
  const paginas = Math.max(1, Math.ceil(d.total / FACTURAS_POR_PAGINA));
  const url = (v: VistaFacturas, p = 1) => `/cuenta/facturas?vista=${v}${p > 1 ? `&pagina=${p}` : ''}`;

  return (
    <Marco usuario={sesion.usuario} titulo="Mis facturas">
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/facturas" />}
      {r.facturasVencidas > 0 ? (
        <div className="notice error" role="status" style={{ marginBottom: 18 }}>
          <h2>
            Tienes {r.facturasVencidas} {r.facturasVencidas === 1 ? 'factura vencida' : 'facturas vencidas'} por {money(r.vencido)}
          </h2>
          <p>Ponte al día con tu vendedor para no frenar tus próximos pedidos.</p>
        </div>
      ) : r.facturasVencenPronto > 0 ? (
        <div className="notice aviso-sellout" role="status">
          <h2>
            {r.facturasVencenPronto === 1 ? 'Una factura vence' : `${r.facturasVencenPronto} facturas vencen`} en los próximos {DIAS_VENCE_PRONTO} días
          </h2>
          <p>Suman {money(r.vencePronto)}.</p>
        </div>
      ) : null}

      <section className="stats">
        <Cifra icono="cobrar" etiqueta="Por pagar de ASTA" valor={money(r.porPagar)} nota={`la parte ASTA de ${r.facturasPorPagar} ${r.facturasPorPagar === 1 ? 'factura' : 'facturas'}`} />
        <Cifra icono="alerta" color="rosa" etiqueta="Vencido" valor={money(r.vencido)} tono={r.vencido > 0 ? 'alerta' : undefined} nota={r.facturasVencidas ? `${r.facturasVencidas} ${r.facturasVencidas === 1 ? 'factura' : 'facturas'}` : 'nada vencido'} />
        <Cifra icono="reloj" color="ambar" etiqueta={`Vence en ${DIAS_VENCE_PRONTO} días`} valor={money(r.vencePronto)} tono={r.vencePronto > 0 ? 'atencion' : undefined} nota={r.proximoVencimiento ? `el próximo, ${fecha(r.proximoVencimiento)}` : 'sin vencimientos próximos'} />
      </section>

      <section className="panel">
        <div className="so-subir-cabeza">
          <h2>{vista === 'pendientes' ? 'Por pagar' : 'Tus facturas con ASTA'}</h2>
          <div className="segmented" role="group" aria-label="Qué facturas ver">
            <Link href={url('pendientes')} aria-current={vista === 'pendientes' ? 'page' : undefined}>
              Por pagar
            </Link>
            <Link href={url('todas')} aria-current={vista === 'todas' ? 'page' : undefined}>
              Todas
            </Link>
          </div>
        </div>

        {d.facturas.length === 0 ? (
          <div className="empty">{vista === 'pendientes' ? 'No debes nada. ¡Al día!' : 'Todavía no tienes facturas con ASTA.'}</div>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Emitida</th>
                  <th>Vence</th>
                  <th className="num">ASTA</th>
                  <th className="num">Saldo de ASTA</th>
                  <th>Estado</th>
                  <th aria-label="PDF" />
                </tr>
              </thead>
              <tbody>
                {d.facturas.map((f) => {
                  const v = cuandoVence(f, hoy);
                  return (
                    <tr key={f.id}>
                      <td>
                        <strong>{f.folio}</strong>
                      </td>
                      <td className="stat-sub factura-fecha">{fecha(f.fecha)}</td>
                      <td className="factura-fecha">
                        {fecha(f.vencimiento)}
                        {v && <div className={`factura-vence${v.tono ? ` factura-${v.tono}` : ''}`}>{v.texto}</div>}
                      </td>
                      <td className="num">{money(f.total)}</td>
                      <td className="num">{f.saldo > 0 ? <strong>{money(f.saldo)}</strong> : '—'}</td>
                      <td>
                        <span className={`tag factura-estado-${f.estadoPago}`}>{PAYMENT_STATE_LABEL[f.estadoPago]}</span>
                      </td>
                      <td>
                        <a className="btn-link" href={`/api/facturas/${f.id}/pdf`} download>
                          PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <nav className="paginacion" aria-label="Páginas">
            {pagina > 1 ? <Link href={url(vista, pagina - 1)}>← Anteriores</Link> : <span />}
            <span className="stat-sub">
              Página {pagina} de {paginas} · {d.total} facturas
            </span>
            {pagina < paginas ? <Link href={url(vista, pagina + 1)}>Siguientes →</Link> : <span />}
          </nav>
        )}
      </section>
    </Marco>
  );
}
