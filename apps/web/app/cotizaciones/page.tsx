import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos, fechasDe } from '@/components/Periodos';
import { ListaCotizaciones, estadoDeParams } from '@/components/Cotizaciones';
import { PedidosClientes } from '@/components/PedidosClientes';
import { getCotizacionesCartera, getPedidosParaAtender, ApiError, ContractError, esRedireccion } from '@/lib/api';

/**
 * Las cotizaciones de ASTA de los clientes de la propia cartera: las abiertas,
 * de la más antigua a la más nueva, son la lista de seguimiento. Ver
 * `ListaCotizaciones`.
 */

export const dynamic = 'force-dynamic';

export default async function CotizacionesCarteraPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  const periodo = desde && hasta ? { desde, hasta } : fechasDe('trimestre');
  const estado = estadoDeParams(params);

  // Los pedidos de clientes van aparte: si fallan, las cotizaciones salen igual.
  const pedidos = getPedidosParaAtender(sesion.accessToken, 'cartera').catch(() => null);
  let datos;
  try {
    datos = await getCotizacionesCartera(sesion.accessToken, periodo, estado);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Cotizaciones y pedidos">
        <div className="notice error">
          <h2>{esPermiso ? 'Tu usuario no tiene cartera asociada' : 'No se pudieron leer las cotizaciones'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const enviados = await pedidos;

  return (
    <Marco usuario={sesion.usuario} titulo="Cotizaciones y pedidos">
      <Periodos base="/cotizaciones" periodo={periodo} />
      {enviados && <PedidosClientes inicial={enviados} />}
      <ListaCotizaciones datos={datos} base="/cotizaciones" periodo={periodo} conVendedor={false} />
    </Marco>
  );
}
