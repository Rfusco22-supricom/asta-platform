import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos, fechasDe } from '@/components/Periodos';
import { Sedes, sedeDeParams } from '@/components/Sedes';
import { ListaCotizaciones, estadoDeParams } from '@/components/Cotizaciones';
import { getCotizacionesEmpresa, ApiError, ContractError, esRedireccion } from '@/lib/api';

/**
 * Las cotizaciones de ASTA de toda la empresa, por periodo, sede y estado. Por
 * defecto, los últimos tres meses: una cotización de hace un año ya no es algo
 * que seguir. Ver `ListaCotizaciones`.
 */

export const dynamic = 'force-dynamic';

export default async function CotizacionesEmpresaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  const periodo = desde && hasta ? { desde, hasta } : fechasDe('trimestre');
  const sede = sedeDeParams(params);
  const estado = estadoDeParams(params);

  let datos;
  try {
    datos = await getCotizacionesEmpresa(sesion.accessToken, periodo, estado, sede);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Cotizaciones">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudieron leer las cotizaciones'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Cotizaciones">
      <Sedes base="/admin/cotizaciones" sede={sede} periodo={periodo} />
      <Periodos base="/admin/cotizaciones" periodo={periodo} sede={sede} />
      <ListaCotizaciones datos={datos} base="/admin/cotizaciones" periodo={periodo} sede={sede} conVendedor />
    </Marco>
  );
}
