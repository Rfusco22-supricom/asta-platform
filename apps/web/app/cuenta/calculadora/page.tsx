import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { getCalculadora, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Calculadora } from './Calculadora';

/**
 * «Calculadora»: cuánto gana el cliente vendiendo ASTA en lugar del original,
 * con los precios de su tarifa. Ver `Calculadora`.
 */

export const dynamic = 'force-dynamic';

export default async function CalculadoraPage({ searchParams }: { searchParams: Promise<{ elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Usuarios»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo="Calculadora de ganancia">
        <ElegirCliente token={sesion.accessToken} destino="/cuenta/calculadora" />
      </Marco>
    );
  }
  const cliente = comoCliente?.id ?? null;
  let datos;
  try {
    datos = await getCalculadora(sesion.accessToken, cliente);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Calculadora de ganancia">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudo abrir la calculadora'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }
  return (
    <Marco usuario={sesion.usuario} titulo="Calculadora de ganancia">
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/calculadora" />}
      <p className="panel-nota" style={{ marginTop: 0 }}>
        Cuánto ganas vendiendo ASTA en lugar del original, con los precios de tu tarifa. Mueve tu margen y el descuento que le das a tu cliente.
      </p>
      <Calculadora datos={datos} />
    </Marco>
  );
}
