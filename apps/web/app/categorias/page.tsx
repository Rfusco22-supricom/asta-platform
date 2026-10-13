import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { CaminoMeta, FILTROS, TablaCategorias, ventana } from '@/components/Categorias';
import { getCategoriasAstaCartera, ApiError, esRedireccion, ContractError } from '@/lib/api';

/**
 * Las categorías de ASTA de los clientes del vendedor (#131): quién es Oro,
 * Plata o Bronce, y sobre todo «Cerca de subir», la lista para llamar.
 */

export const dynamic = 'force-dynamic';

export default async function CategoriasVendedorPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sesion = await requireSession();
  const { ver } = await searchParams;
  const filtro = FILTROS.some((f) => f.valor === ver) ? ver! : 'cerca';

  let datos;
  try {
    datos = await getCategoriasAstaCartera(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Categorías ASTA">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta pantalla es para vendedores' : 'No se pudo leer de Odoo'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Categorías ASTA"
      descripcion={`Tus clientes por lo que compran de ASTA · promedio de ${ventana(datos.meses)}`}
    >
      <CaminoMeta datos={datos} alcance="Tu cartera" />
      <TablaCategorias datos={datos} filtro={filtro} base="/categorias" conVendedor={false} />
    </Marco>
  );
}
