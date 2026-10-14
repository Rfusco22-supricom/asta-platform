import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos } from '@/components/Periodos';
import { PestanasReportes } from '@/components/PestanasReportes';
import { getReporteProductos, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { money, moneyCompact } from '@/lib/formato';
import { VistaProductos } from './VistaProductos';
import { Cifra } from '@/components/Cifras';

/**
 * Qué productos ASTA compran los clientes de la PROPIA cartera.
 *
 * El recorte a la cartera lo hace el endpoint con el `odooUserId` del token;
 * aquí no se pide un alcance ni se filtra nada después. Los importes van sin
 * impuestos, como el resumen (los dos son solo ASTA).
 */

export const dynamic = 'force-dynamic';

function rangoDe(params: Record<string, string | string[] | undefined>) {
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  return desde && hasta ? { desde, hasta } : undefined;
}

export default async function ReporteProductosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const rango = rangoDe(await searchParams);

  let datos;
  try {
    datos = await getReporteProductos(sesion.accessToken, rango);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Reportes">
        <PestanasReportes actual="productos" periodo={rango} />
        <div className="notice error">
          <h2>{esPermiso ? 'Esta pantalla es para vendedores' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const { totales, periodo } = datos;

  return (
    <Marco usuario={sesion.usuario} titulo="Reportes" descripcion={`Tu cartera · productos ASTA, sin IVA · ${periodo.desde} a ${periodo.hasta}`}>
      <PestanasReportes actual="productos" periodo={periodo} />
      <Periodos base="/reportes/productos" periodo={periodo} />

      <section className="stats">
        <Cifra icono="ventas" etiqueta="Vendido en ASTA" valor={moneyCompact(totales.monto)} nota={`${money(totales.monto)} sin IVA`} />
        <Cifra icono="clientes" color="verde" etiqueta="Clientes que compraron ASTA" valor={totales.clientes} nota="en el periodo" />
        <Cifra icono="caja" color="violeta" etiqueta="Productos ASTA distintos" valor={totales.productos} nota={`en ${datos.categorias.length} categorías`} />
      </section>

      {datos.apartados.map((a) => (
        <p key={a.sku} className="panel-nota">
          No se cuentan {money(a.monto)} de «{a.nombre}» ({a.clientes} {a.clientes === 1 ? 'cliente' : 'clientes'}): son saldos de apertura cargados como factura, no ventas de un producto.
        </p>
      ))}

      <VistaProductos categorias={datos.categorias} clientes={datos.clientes} />
    </Marco>
  );
}
