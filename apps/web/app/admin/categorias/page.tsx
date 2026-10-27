import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { CaminoMeta } from '@/components/Categorias';
import { FILTROS_PROGRAMA, TablaPrograma } from '@/components/ProgramaStaff';
import { getCategoriasAstaEmpresa, getProgramaEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { PestanasSeccion, PESTANAS_ASTA_ADMIN } from '@/components/PestanasSeccion';

/**
 * El programa de ASTA de toda la empresa: cómo va el conjunto hacia la meta
 * (#131), con cada cliente en su nivel del programa, y el trimestre en curso
 * cliente a cliente: quién sube, quién baja y quién está en juego.
 *
 * Lo calcula el middleware (`programaAsta.service`). Esta página lo enseña y lo
 * filtra.
 */

export const dynamic = 'force-dynamic';

function Tabla({ programa, ...resto }: { programa: Awaited<ReturnType<typeof getProgramaEmpresa>> | null; filtro: string; base: string; conVendedor: boolean }) {
  if (!programa) {
    return (
      <section className="panel">
        <h2>El trimestre</h2>
        <div className="empty">No se pudo leer ahora.</div>
      </section>
    );
  }
  return <TablaPrograma datos={programa} {...resto} />;
}

export default async function CategoriasAdminPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sesion = await requireSession();
  const { ver } = await searchParams;
  const filtro = FILTROS_PROGRAMA.some((f) => f.valor === ver) ? ver! : 'programa';

  // La tabla va aparte: si falla, la meta sale igual.
  const programa = getProgramaEmpresa(sesion.accessToken).catch(() => null);
  let datos;
  try {
    datos = await getCategoriasAstaEmpresa(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="ASTA">
        <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_ADMIN} actual="/admin/categorias" />
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo leer de Odoo'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="ASTA">
      <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_ADMIN} actual="/admin/categorias" />
      <CaminoMeta datos={datos} />
      <Tabla programa={await programa} filtro={filtro} base="/admin/categorias" conVendedor />
    </Marco>
  );
}
