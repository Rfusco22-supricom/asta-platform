import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Cifra } from '@/components/Cifras';
import { getPorMarcar, getSellOutCliente, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { etiquetaMes, nombreMes } from '@/lib/meses';
import { fecha } from '@/lib/formato';
import { SubirSellOut } from './SubirSellOut';
import { LoQueTeVendimos } from './LoQueTeVendimos';

/**
 * «Mi sell-out»: lo que el cliente vende de ASTA (fase 2).
 *
 * Marca lo que vende de lo que le vendimos («Lo que te vendimos»), o sube sus
 * ventas del mes o su inventario al cierre con la plantilla; aquí ve, mes a
 * mes, lo que compró a Supricom frente a lo que vendió, y por producto para
 * cuántos días le alcanza la existencia.
 */

export const dynamic = 'force-dynamic';

const n = (x: number | null) => (x === null ? '—' : x.toLocaleString('es-VE', { maximumFractionDigits: 2 }));

export default async function SellOutPage() {
  const sesion = await requireSession();

  let r;
  // «Lo que te vendimos» va aparte: si falla, el resto de la página sale igual.
  // Una sesión caducada la detecta la otra llamada, que sí redirige.
  const marcar = getPorMarcar(sesion.accessToken).catch(() => null);
  try {
    r = await getSellOutCliente(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Mi sell-out">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudo cargar tu sell-out'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }

  const porMarcar = await marcar;
  const ultimo = r.mesProductos ? r.meses.find((m) => m.mes === r.mesProductos) : undefined;
  const reponer = r.productos.filter((p) => p.reponer).length;

  return (
    <Marco usuario={sesion.usuario} titulo="Mi sell-out">
      {ultimo && (
        <section className="stats">
          <Cifra icono="ventas" etiqueta={`Vendido · ${etiquetaMes(ultimo.mes)}`} valor={n(ultimo.vendidas)} nota="unidades" />
          <Cifra icono="caja" color="violeta" etiqueta={`Comprado · ${etiquetaMes(ultimo.mes)}`} valor={n(ultimo.compradas)} nota="unidades" />
          <Cifra icono="caja" color="verde" etiqueta="Existencia" valor={n(ultimo.existencia)} nota="unidades al cierre" />
          <Cifra icono="alerta" color="ambar" etiqueta="Para reponer" valor={reponer} tono={reponer > 0 ? 'atencion' : undefined} nota="menos de 30 días" />
        </section>
      )}

      {porMarcar ? (
        <LoQueTeVendimos inicial={porMarcar} />
      ) : (
        <section className="panel">
          <h2>Lo que te vendimos</h2>
          <div className="empty">No se pudo leer ahora.</div>
        </section>
      )}

      <SubirSellOut />

      <section className="panel">
        <h2>Mes a mes</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">Comprado</th>
                <th className="num">Vendido</th>
                <th className="num">Existencia</th>
                <th>De dónde</th>
              </tr>
            </thead>
            <tbody>
              {[...r.meses].reverse().map((m) => (
                <tr key={m.mes}>
                  <td>{nombreMes(m.mes)}</td>
                  <td className="num">{n(m.compradas)}</td>
                  <td className="num">{n(m.vendidas)}</td>
                  <td className="num">{n(m.existencia)}</td>
                  <td className="stat-sub">{m.fuente === 'VENTAS' ? 'Ventas' : m.fuente === 'INVENTARIO' ? 'Inventario' : 'Sin reportar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r.mesProductos && r.productos.length > 0 && (
        <section className="panel">
          <h2>Por producto · {nombreMes(r.mesProductos)}</h2>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Comprado</th>
                  <th className="num">Vendido</th>
                  <th className="num">Existencia</th>
                  <th className="num">Días</th>
                </tr>
              </thead>
              <tbody>
                {r.productos.map((p) => (
                  <tr key={p.productId}>
                    <td>
                      {p.nombre.replace(/^ASTA\s+/i, '')}
                      {p.sku && <div className="sku">{p.sku}</div>}
                    </td>
                    <td className="num">{n(p.compradas)}</td>
                    <td className="num">{n(p.vendidas)}</td>
                    <td className="num">{n(p.existencia)}</td>
                    <td className="num">
                      {p.diasInventario === null ? '—' : p.diasInventario}
                      {p.reponer && <span className="tag so-reponer">Reponer</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {r.reportes.length > 0 && (
        <section className="panel">
          <h2>Lo que has subido</h2>
          <ul className="so-historial">
            {r.reportes.map((x) => (
              <li key={x.id} className={x.vigente ? undefined : 'so-reemplazado'}>
                <strong>{nombreMes(x.mes)}</strong> · {x.tipo === 'VENTAS' ? 'Ventas' : 'Inventario'} · {n(x.unidades)} u. en {x.filas}{' '}
                {x.filas === 1 ? 'producto' : 'productos'}
                <span className="stat-sub">
                  {' '}
                  · {x.archivo} · {fecha(x.subidoEn.slice(0, 10))}
                  {!x.vigente && ' · sustituido'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Marco>
  );
}
