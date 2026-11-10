import { Suspense } from 'react';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { ProgramaCliente } from '@/components/ProgramaCliente';
import { Beneficios } from '@/components/Beneficios';
import { ComparativaZona } from '@/components/ComparativaZona';
import { getMetricasCliente, ApiError, esRedireccion, ContractError } from '@/lib/api';

/**
 * «Mi nivel y beneficios»: el programa de ASTA del cliente en detalle. Cómo va
 * en el trimestre (meses, cuotas, sell-out, tokens extra), sus beneficios y los
 * del nivel siguiente, y cómo va frente a su zona. El Inicio lo resume
 * (`NivelCorto`) y enlaza aquí (reorganización del 2026-11-10).
 */

export const dynamic = 'force-dynamic';

const TITULO = 'Mi nivel y beneficios';

export default async function NivelPage({ searchParams }: { searchParams: Promise<{ elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Ver su panel»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo={TITULO}>
        <ElegirCliente token={sesion.accessToken} destino="/cuenta/nivel" />
      </Marco>
    );
  }
  const cliente = comoCliente?.id ?? null;

  let programa;
  try {
    programa = (await getMetricasCliente(sesion.accessToken, cliente)).programa;
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo={TITULO}>
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudo cargar tu nivel'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo={TITULO}>
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/nivel" />}
      <ProgramaCliente programa={programa} />
      {programa && <Beneficios nivel={programa.evaluacion.nivel} para="cliente" />}
      <Suspense fallback={<div className="panel dash-esqueleto" style={{ minHeight: 220 }} aria-busy="true" />}>
        <ComparativaZona token={sesion.accessToken} cliente={cliente} />
      </Suspense>
    </Marco>
  );
}
