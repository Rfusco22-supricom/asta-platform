import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getAstaCartera, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { TablaAsta } from '../admin/asta/TablaAsta';

/**
 * Oportunidades de ASTA en la cartera de UN vendedor.
 *
 * Mismo dato que la pantalla del administrador, acotado a sus clientes. El
 * recorte lo hace el endpoint a partir del `odooUserId` del token: aquí no se
 * pide un alcance ni se filtra nada después, porque filtrar en el navegador deja
 * los datos de los demás pasando por el servidor de Next.
 *
 * ── Por qué el vendedor tiene su versión ─────────────────────────────────────
 *
 * Porque es quien llama al cliente. La pantalla del administrador dice cuánto se
 * está perdiendo; esta dice a quién llamar mañana, con el nombre delante.
 */

export const dynamic = 'force-dynamic';

export default async function AstaCarteraPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getAstaCartera(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Oportunidades ASTA">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta pantalla es para vendedores' : 'No se pudo cargar'}</h2>
          <p>
            {error instanceof ContractError || error instanceof ApiError
              ? error.message
              : 'Error inesperado.'}
          </p>
        </div>
      </Marco>
    );
  }

  const { filas, totales } = datos;

  if (filas.length === 0) {
    return (
      <Marco usuario={sesion.usuario} titulo="Oportunidades ASTA">
        <div className="notice">
          <h2>Ningún cliente tuyo compra consumibles todavía</h2>
          <p>
            Cuando alguno facture tóner o consumibles, aparecerá aquí con el reparto entre ASTA y
            las demás marcas.
          </p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Oportunidades ASTA"
      descripcion={`${totales.clientes} de tus clientes compran consumibles · tu cuota de ASTA es del ${totales.cuota.toFixed(1)} %`}
    >
      <section className="stats">
        <div className="stat">
          <div className="stat-label">TU CUOTA DE ASTA</div>
          <div className="stat-value">{totales.cuota.toFixed(1)} %</div>
          <div className="stat-sub">del consumible que compran tus clientes</div>
        </div>
        <div className="stat">
          <div className="stat-label">A LA COMPETENCIA</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>
            {moneyCompact(totales.competencia)}
          </div>
          <div className="stat-sub">mismo producto, otra marca</div>
        </div>
        <div className="stat">
          <div className="stat-label">SIN PROBAR ASTA</div>
          <div className="stat-value" style={{ color: 'var(--warning)' }}>
            {totales.sinAsta}
          </div>
          <div className="stat-sub">
            clientes tuyos · {moneyCompact(totales.sinAstaImporte)} fuera
          </div>
        </div>
      </section>

      <TablaAsta filas={filas} conVendedor={false} />
    </Marco>
  );
}
