import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { VistaReporte } from '@/components/Reporte';
import { getReporteEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';

/**
 * Reportes de facturación de toda la empresa.
 *
 * Es la pantalla que faltaba para que el entregable del roadmap se cumpla: «los
 * vendedores usan el panel a diario y dejan de pedir reportes». Hasta ahora el
 * panel enseñaba el histórico de cada cliente uno a uno, y la pregunta de «cómo
 * vamos este trimestre» seguía contestándose pidiéndosela a alguien.
 */

export const dynamic = 'force-dynamic';

function rangoDe(params: Record<string, string | string[] | undefined>) {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  // Las dos o ninguna: el middleware rechaza una sola, y aquí se evita el viaje.
  return desde && hasta ? { desde, hasta } : undefined;
}

export default async function ReportesAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requireSession();
  const rango = rangoDe(await searchParams);

  let datos;
  try {
    datos = await getReporteEmpresa(sesion.accessToken, rango);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Reportes">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
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
      descripcion={`Toda la empresa · ${datos.periodo.desde} a ${datos.periodo.hasta}`}
    >
      <VistaReporte datos={datos} base="/admin/reportes" />
    </Marco>
  );
}
