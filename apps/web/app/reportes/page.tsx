import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { VistaReporte } from '@/components/Reporte';
import { PestanasReportes } from '@/components/PestanasReportes';
import { getReporteCartera, ApiError, esRedireccion, ContractError } from '@/lib/api';

/**
 * Reportes de la PROPIA cartera.
 *
 * Mismo dato que la pantalla del administrador, acotado a sus clientes. El
 * recorte lo hace el endpoint a partir del `odooUserId` del token: aquí no se
 * pide un alcance ni se filtra nada después.
 *
 * `porVendedor` llega en `null` y el componente no dibuja esa tabla. No es una
 * condición de presentación: esa ruta ni siquiera calcula el corte por vendedor,
 * así que no hay nada que se pueda escapar por un fallo de plantilla.
 */

export const dynamic = 'force-dynamic';

function rangoDe(params: Record<string, string | string[] | undefined>) {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  return desde && hasta ? { desde, hasta } : undefined;
}

export default async function ReportesCarteraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requireSession();
  const rango = rangoDe(await searchParams);

  let datos;
  try {
    datos = await getReporteCartera(sesion.accessToken, rango);
  } catch (error) {
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Reportes">
        {/* Que un fallo del resumen no deje también sin llegar a «Por producto». */}
        <PestanasReportes actual="resumen" periodo={rango} />
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

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Reportes"
      descripcion={`Tu cartera · ${datos.periodo.desde} a ${datos.periodo.hasta}`}
    >
      <PestanasReportes actual="resumen" periodo={datos.periodo} />
      <VistaReporte datos={datos} base="/reportes" />
    </Marco>
  );
}
