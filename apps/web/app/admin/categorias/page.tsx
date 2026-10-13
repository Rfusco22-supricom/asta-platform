import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { CaminoMeta, FILTROS, TablaCategorias, ventana } from '@/components/Categorias';
import { getCategoriasAstaEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';

/**
 * Categorías de ASTA de toda la empresa (#131): en qué categoría está cada
 * cliente, cuánto le falta para subir, y cómo va el conjunto hacia la meta.
 *
 * La categoría la calcula el middleware con los cuatro últimos meses completos
 * (`categoriasAsta.service`). Esta página solo la enseña y la filtra.
 */

export const dynamic = 'force-dynamic';

export default async function CategoriasAdminPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sesion = await requireSession();
  const { ver } = await searchParams;
  const filtro = FILTROS.some((f) => f.valor === ver) ? ver! : 'programa';

  let datos;
  try {
    datos = await getCategoriasAstaEmpresa(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Categorías ASTA">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo leer de Odoo'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Categorías ASTA"
      descripcion={`Diamante, Oro, Plata y Bronce según lo que compra cada cliente de ASTA · promedio de ${ventana(datos.meses)}, agrupado por RIF`}
    >
      <CaminoMeta datos={datos} alcance="Toda la empresa" />
      <TablaCategorias datos={datos} filtro={filtro} base="/admin/categorias" conVendedor />
    </Marco>
  );
}
