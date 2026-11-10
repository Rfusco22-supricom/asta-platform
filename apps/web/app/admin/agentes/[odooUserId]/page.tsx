import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DIAS_SIN_RESPUESTA } from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Avatar } from '@/components/Avatar';
import { VistaReporte } from '@/components/Reporte';
import { TablaPrograma } from '@/components/ProgramaStaff';
import { fechasDe } from '@/components/Periodos';
import { Esqueleto, Fallo, intentar, n } from '@/components/inicio/Tablero';
import { getAgentes, getCotizacionesEmpresa, getProgramaEmpresa, getReporteVendedor } from '@/lib/api';
import { fecha, moneyEntero } from '@/lib/formato';

/**
 * La página de un vendedor, desde Vendedores: todo lo suyo de ASTA en un sitio.
 *
 *   · sus ventas de ASTA: lo mismo que él ve en «Mis ventas» (cifras, mes a
 *     mes y sus clientes que más compran), con el periodo elegido;
 *   · su cartera en el programa ASTA este trimestre;
 *   · sus cotizaciones abiertas.
 *
 * Solo montos de ASTA, como el resto del panel. Cada bloque llega por su cuenta.
 */

export const dynamic = 'force-dynamic';

function rangoDe(params: Record<string, string | string[] | undefined>) {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  return desde && hasta ? { desde, hasta } : undefined;
}

async function Ventas({ token, id, rango }: { token: string; id: number; rango: { desde: string; hasta: string } }) {
  const r = await intentar(() => getReporteVendedor(token, id, rango));
  if (!r) return <Fallo area="serie" titulo="Sus ventas de ASTA" />;
  return <VistaReporte datos={r} base={`/admin/agentes/${id}`} soloAsta />;
}

async function Programa({ token, id, filtro }: { token: string; id: number; filtro: string }) {
  const r = await intentar(() => getProgramaEmpresa(token));
  if (!r) return <Fallo area="programa" titulo="Su cartera en el programa ASTA" />;
  const datos = { ...r, clientes: r.clientes.filter((c) => c.vendedorOdooUserId === id) };
  if (datos.clientes.length === 0) {
    return (
      <section className="panel">
        <h2>Su cartera en el programa ASTA</h2>
        <div className="empty">Ningún cliente suyo está en el programa este trimestre.</div>
      </section>
    );
  }
  return <TablaPrograma datos={datos} filtro={filtro} base={`/admin/agentes/${id}`} conVendedor={false} />;
}

async function Cotizaciones({ token, id }: { token: string; id: number }) {
  const r = await intentar(() => getCotizacionesEmpresa(token, fechasDe('12m'), 'abierta', null, id));
  if (!r) return <Fallo area="cotizaciones" titulo="Sus cotizaciones abiertas" />;
  const filas = r.filas.slice(0, 10);
  return (
    <section className="panel">
      <div className="dash-cabeza">
        <h2>Sus cotizaciones abiertas</h2>
        <span className="stat-sub">
          {n(r.totales.abierta.cotizaciones)} abiertas · {n(r.totales.sinRespuesta)} sin respuesta hace más de {DIAS_SIN_RESPUESTA} días
        </span>
      </div>
      {filas.length === 0 ? (
        <div className="empty">No tiene cotizaciones abiertas.</div>
      ) : (
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Cotización</th>
                <th className="num">ASTA</th>
                <th className="num">Espera</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/cartera/${c.partnerId}`} className="enlace-ficha" data-privado>
                      {c.cliente}
                    </Link>
                  </td>
                  <td>
                    {c.folio} <span className="stat-sub">· {fecha(c.fecha)}</span>
                  </td>
                  <td className="num">{moneyEntero(c.importeAsta)}</td>
                  <td className={`num${c.dias > DIAS_SIN_RESPUESTA ? ' debt' : ''}`}>{c.dias === 1 ? '1 día' : `${n(c.dias)} días`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.filas.length > filas.length && <p className="panel-nota">Las 10 más antiguas de {n(r.totales.abierta.cotizaciones)}.</p>}
    </section>
  );
}

export default async function VendedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ odooUserId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requireSession();
  const id = Number((await params).odooUserId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  const rango = rangoDe(sp) ?? fechasDe('12m');
  const filtro = typeof sp.ver === 'string' ? sp.ver : 'programa';
  const token = sesion.accessToken;

  const agentes = await intentar(() => getAgentes(token));
  const a = agentes?.filas.find((x) => x.odooUserId === id) ?? null;
  const nombre = a?.nombre ?? `Vendedor ${id}`;
  const acceso = !a ? null : !a.cuenta ? 'Sin cuenta en el panel' : !a.cuenta.puedeEntrar ? 'Tiene cuenta, sin contraseña' : a.cuenta.ultimoAcceso ? `Entró al panel el ${fecha(a.cuenta.ultimoAcceso)}` : 'Tiene acceso, aún no ha entrado';

  return (
    <Marco usuario={sesion.usuario} titulo={nombre} tituloPrivado>
      <div className="panel ficha-cabeza">
        <Avatar nombre={nombre} tamano="l" />
        <div className="ficha-datos">
          <div className="crumb">
            <Link href="/admin/agentes">Vendedores</Link> <span>/</span> <span data-privado>{nombre}</span>
          </div>
          <span className="ficha-tarifa">
            {a ? `${n(a.clientes)} clientes en su cartera · ${n(a.conCompra)} compran ASTA` : 'No está en la lista de vendedores de Odoo'}
          </span>
          {a && (
            <span className="stat-sub">
              <span data-privado>{a.login}</span>
              {acceso ? ` · ${acceso}` : ''}
            </span>
          )}
        </div>
      </div>

      <Suspense fallback={<Esqueleto area="serie" alto={420} />}>
        <Ventas token={token} id={id} rango={rango} />
      </Suspense>
      <Suspense fallback={<Esqueleto area="programa" alto={300} />}>
        <Programa token={token} id={id} filtro={filtro} />
      </Suspense>
      <Suspense fallback={<Esqueleto area="cotizaciones" alto={240} />}>
        <Cotizaciones token={token} id={id} />
      </Suspense>
    </Marco>
  );
}
