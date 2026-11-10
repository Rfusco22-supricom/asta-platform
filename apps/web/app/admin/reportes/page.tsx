import { Suspense } from 'react';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { VistaReporte } from '@/components/Reporte';
import { sedeDeParams } from '@/components/Sedes';
import { getReporteEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { ProductosAsta } from '@/components/inicio/Ranking';
import { Esqueleto } from '@/components/inicio/Tablero';

/**
 * Ventas: los reportes de facturación de toda la empresa, con los productos
 * ASTA más vendidos (antes en el Inicio). Entrada propia en el menú desde la
 * reorganización del 2026-11-10; antes solo se llegaba desde el Inicio.
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
  const params = await searchParams;
  const rango = rangoDe(params);
  const sede = sedeDeParams(params);

  let datos;
  try {
    datos = await getReporteEmpresa(sesion.accessToken, rango, sede);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Ventas">
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
    <Marco usuario={sesion.usuario} titulo="Ventas">
      <VistaReporte datos={datos} base="/admin/reportes" soloAsta sede={sede} />
      <div className="ventas-productos">
        <Suspense fallback={<Esqueleto area="productos" alto={300} />}>
          <ProductosAsta token={sesion.accessToken} rango={datos.periodo} sede={sede} cuantos={15} />
        </Suspense>
      </div>
    </Marco>
  );
}
