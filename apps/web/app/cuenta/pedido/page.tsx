import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { getPedidoSugerido, getPedidosCliente, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { fecha, money } from '@/lib/formato';
import type { EstadoPedidoCliente } from '@asta/shared-types';
import { PedidoEditable } from './PedidoEditable';

/**
 * «Pedido sugerido»: lo que el cliente debería reponer de ASTA, con lo que
 * vende (su sell-out) o, si no lo reporta, con lo que suele comprarnos. Lo
 * ajusta y lo envía a su vendedor. Debajo, en qué quedaron sus pedidos.
 */

export const dynamic = 'force-dynamic';

const ESTADO: Record<EstadoPedidoCliente, string> = { ENVIADO: 'Enviado', EN_ODOO: 'Cotizado', DESCARTADO: 'Descartado' };

export default async function PedidoPage({ searchParams }: { searchParams: Promise<{ elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Ver su panel»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo="Pedidos">
        <ElegirCliente token={sesion.accessToken} destino="/cuenta/pedido" />
      </Marco>
    );
  }
  const cliente = comoCliente?.id ?? null;

  let sugerido;
  // El historial va aparte: si falla, el pedido sale igual.
  const historial = getPedidosCliente(sesion.accessToken, cliente).catch(() => null);
  try {
    sugerido = await getPedidoSugerido(sesion.accessToken, cliente);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Pedidos">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudo calcular tu pedido'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }
  const pedidos = await historial;
  const sinAtender = pedidos?.filter((p) => p.estado === 'ENVIADO') ?? [];

  return (
    <Marco usuario={sesion.usuario} titulo="Pedidos">
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/pedido" />}
      {sinAtender.length > 0 && (
        <div className="notice aviso-sellout" role="status">
          <h2>
            {sinAtender.length === 1
              ? `Tu pedido del ${fecha(sinAtender[0]!.enviadoEn.slice(0, 10))} está pendiente`
              : `Tienes ${sinAtender.length} pedidos pendientes`}
          </h2>
          <p>{sinAtender.length === 1 ? 'Tu vendedor todavía no lo ha pasado a cotización. La sugerencia de abajo no lo descuenta' : 'Tu vendedor todavía no los ha pasado a cotización. La sugerencia de abajo no los descuenta'}: si envías otro, se suma.</p>
        </div>
      )}
      {comoCliente ? (
        // Mirando como administrador: se ve, pero no se envía nada en su nombre.
        <fieldset disabled className="solo-ver">
          <PedidoEditable inicial={sugerido} />
        </fieldset>
      ) : (
        <PedidoEditable inicial={sugerido} />
      )}

      {pedidos && pedidos.length > 0 && (
        <section className="panel">
          <h2>Tus pedidos</h2>
          <ul className="so-historial">
            {pedidos.map((p) => (
              <li key={p.id}>
                <strong>{fecha(p.enviadoEn.slice(0, 10))}</strong> · {p.lineas.length} {p.lineas.length === 1 ? 'producto' : 'productos'}, {p.unidades} u.
                {p.importeEstimado !== null && ` · ${money(p.importeEstimado)}`}{' '}
                <span className={`tag pedido-estado pedido-${p.estado.toLowerCase()}`}>{ESTADO[p.estado]}</span>
                <span className="stat-sub">
                  {p.estado === 'EN_ODOO' && p.folioOdoo && ` · cotización ${p.folioOdoo}`}
                  {p.estado === 'DESCARTADO' && p.motivo && ` · ${p.motivo}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Marco>
  );
}
