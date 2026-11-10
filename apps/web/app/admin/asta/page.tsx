import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Sedes, sedeDeParams } from '@/components/Sedes';
import { getAstaEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { TablaAsta } from './TablaAsta';
import { Cifra } from '@/components/Cifras';

/**
 * Clientes: lo que cada cliente compra de ASTA, y quiénes nunca lo han probado.
 *
 * Solo montos de ASTA (decidido con Supricom el 2026-11-10). Los que nunca han
 * comprado ASTA salen de los que compran consumibles —CONSUMIBLES y GENERAL,
 * donde ASTA fabrica—, pero lo que compran de otras marcas no se enseña.
 */

export const dynamic = 'force-dynamic';

export default async function AstaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const sede = sedeDeParams(await searchParams);

  let datos;
  try {
    datos = await getAstaEmpresa(sesion.accessToken, sede);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Clientes">
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

  const { filas, totales } = datos;
  const compran = filas.filter((f) => f.asta > 0).length;

  return (
    <Marco usuario={sesion.usuario} titulo="Clientes">
      <Sedes base="/admin/asta" sede={sede} />
      <section className="stats">
        <Cifra icono="ventas" color="verde" etiqueta="Vendido en ASTA" valor={moneyCompact(totales.asta)} nota="histórico, sin IVA" />
        <Cifra icono="clientes" etiqueta="Compran ASTA" valor={compran.toLocaleString('es-VE')} nota="clientes que lo han comprado alguna vez" />
        <Cifra
          icono="diana"
          color="violeta"
          etiqueta="Nunca han comprado ASTA"
          valor={totales.sinAsta.toLocaleString('es-VE')}
          tono="atencion"
          nota="clientes que compran consumibles: la primera prueba"
        />
      </section>

      <TablaAsta filas={filas} conVendedor />
    </Marco>
  );
}
