import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Cifra } from '@/components/Cifras';
import { InsigniaCategoria } from '@/components/Categorias';
import { PestanasSeccion, PESTANAS_ASTA_ADMIN } from '@/components/PestanasSeccion';
import { getSellOutEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { etiquetaMes, nombreMes } from '@/lib/meses';

/**
 * ASTA → Sell-out: lo que reportan vender los clientes en un mes, el
 * inventario que tienen (el inventario en el canal) y quién del programa no ha
 * reportado. Por defecto, el último mes completo.
 */

export const dynamic = 'force-dynamic';

const n = (x: number | null) => (x === null ? '—' : x.toLocaleString('es-VE', { maximumFractionDigits: 2 }));

function ultimosMeses(): string[] {
  const hoy = new Date();
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
}

export default async function SellOutAdminPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sesion = await requireSession();
  const pedido = (await searchParams).mes;
  const mes = pedido && /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : undefined;

  let d;
  try {
    d = await getSellOutEmpresa(sesion.accessToken, mes);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="ASTA">
        <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_ADMIN} actual="/admin/sellout" />
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="ASTA">
      <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_ADMIN} actual="/admin/sellout" />
      <nav className="periodos" aria-label="Mes">
        {ultimosMeses().map((m) => (
          <Link key={m} href={`/admin/sellout?mes=${m}`} className={m === d.mes ? 'periodo periodo--activo' : 'periodo'} aria-current={m === d.mes ? 'page' : undefined}>
            {etiquetaMes(m)}
          </Link>
        ))}
      </nav>

      <section className="stats">
        <Cifra icono="clientes" etiqueta="Clientes que reportan" valor={d.totales.clientesReportan} nota={nombreMes(d.mes)} />
        <Cifra icono="ventas" color="verde" etiqueta="Vendido" valor={n(d.totales.vendidas)} nota="unidades" />
        <Cifra icono="caja" color="violeta" etiqueta="Comprado a Supricom" valor={n(d.totales.compradas)} nota="unidades" />
        <Cifra icono="caja" color="ambar" etiqueta="Inventario en el canal" valor={n(d.totales.existencia)} nota="unidades al cierre" />
      </section>

      <section className="panel">
        <h2>Clientes</h2>
        {d.clientes.length === 0 ? (
          <div className="empty">Nadie ha reportado {nombreMes(d.mes).toLowerCase()}.</div>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Comprado</th>
                  <th className="num">Vendido</th>
                  <th className="num">Existencia</th>
                  <th>De dónde</th>
                </tr>
              </thead>
              <tbody>
                {d.clientes.map((c) => (
                  <tr key={c.partnerId}>
                    <td>{c.nombre}</td>
                    <td className="num">{n(c.compradas)}</td>
                    <td className="num">{n(c.vendidas)}</td>
                    <td className="num">{n(c.existencia)}</td>
                    <td className="stat-sub">{c.fuente === 'VENTAS' ? 'Ventas' : c.fuente === 'INVENTARIO' ? 'Inventario' : 'Solo inventario de este mes'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="met-rejilla">
        <section className="panel">
          <h2>Productos que más se venden</h2>
          {d.productos.length === 0 ? (
            <div className="empty">Sin datos este mes.</div>
          ) : (
            <ol className="met-lista">
              {d.productos.map((p) => (
                <li key={p.productId}>
                  <span>
                    {p.nombre.replace(/^ASTA\s+/i, '')}
                    {p.sku && <span className="sku"> · {p.sku}</span>}
                  </span>
                  <strong>{n(p.vendidas)}</strong>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <h2>
            Sin reportar <span className="pi-cuenta">{d.sinReportar.length}</span>
          </h2>
          {d.sinReportar.length === 0 ? (
            <div className="empty">Todos los clientes del programa han reportado.</div>
          ) : (
            <ol className="met-lista">
              {d.sinReportar.slice(0, 30).map((c) => (
                <li key={c.partnerId}>
                  <span>
                    {c.nombre}
                    {c.vendedor && <span className="stat-sub"> · {c.vendedor}</span>}
                  </span>
                  <InsigniaCategoria categoria={c.categoria} />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Marco>
  );
}
