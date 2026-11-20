import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { CaminoMeta } from '@/components/Categorias';
import { BeneficiosPorNivel } from '@/components/Beneficios';
import { FILTROS_PROGRAMA, TablaPrograma } from '@/components/ProgramaStaff';
import { Periodos } from '@/components/Periodos';
import { getCategoriasAstaEmpresa, getProgramaEmpresa, getReporteEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { nombrePeriodo } from '@/lib/meses';

/**
 * El programa de ASTA de toda la empresa: cómo va el conjunto hacia la meta
 * (#131), con cada cliente en su nivel del programa, y el trimestre en curso
 * cliente a cliente: quién sube, quién baja y quién está en juego.
 *
 * Lo calcula el middleware (`programaAsta.service`). Esta página lo enseña y lo
 * filtra.
 *
 * La cifra grande es la del Inicio: lo vendido en el mes del filtro (el último
 * mes del periodo; por defecto, el que va en curso) frente a la misma meta. La
 * compra media de las categorías va debajo, con su nombre.
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

/** El mes en curso, del día 1 a hoy. */
function mesEnCurso(): { desde: string; hasta: string } {
  const hoy = new Date().toISOString().slice(0, 10);
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
}

export default async function CategoriasAdminPage({ searchParams }: { searchParams: Promise<{ ver?: string; desde?: string; hasta?: string }> }) {
  const sesion = await requireSession();
  const { ver, desde, hasta } = await searchParams;
  const filtro = FILTROS_PROGRAMA.some((f) => f.valor === ver) ? ver! : 'programa';
  const rango = desde && hasta && /^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? { desde, hasta } : mesEnCurso();
  // El mes del filtro, como en el Inicio: el último del periodo.
  const delMes = { desde: `${rango.hasta.slice(0, 7)}-01`, hasta: rango.hasta };
  const enCurso = rango.hasta.slice(0, 7) === new Date().toISOString().slice(0, 7);

  // La tabla y lo vendido en el mes van aparte: si fallan, la meta sale igual.
  const programa = getProgramaEmpresa(sesion.accessToken).catch(() => null);
  const ventas = getReporteEmpresa(sesion.accessToken, delMes, null).catch((e: unknown) => {
    if (esRedireccion(e)) throw e;
    return null;
  });
  let datos;
  try {
    datos = await getCategoriasAstaEmpresa(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Niveles y trimestre">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo leer de Odoo'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Niveles y trimestre">
      <Periodos base="/admin/categorias" periodo={rango} />
      <CaminoMeta datos={datos} mes={await ventas.then((v) => (v ? { vendido: v.totales.facturado, nombre: nombrePeriodo(delMes.desde, delMes.hasta), enCurso } : null))} />
      <Tabla programa={await programa} filtro={filtro} base="/admin/categorias" conVendedor />
      <BeneficiosPorNivel />
    </Marco>
  );
}
