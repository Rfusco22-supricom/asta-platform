import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getAstaCartera, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';
import { TablaAsta } from '../admin/asta/TablaAsta';
import { PestanasReportes } from '@/components/PestanasReportes';

/**
 * Oportunidades de ASTA en la cartera de UN vendedor.
 *
 * Mismo dato que la pantalla del administrador, acotado a sus clientes. El
 * recorte lo hace el endpoint a partir del `odooUserId` del token: aquí no se
 * pide un alcance ni se filtra nada después, porque filtrar en el navegador deja
 * los datos de los demás pasando por el servidor de Next.
 *
 * ── Por qué el vendedor tiene su versión ─────────────────────────────────────
 *
 * Porque es quien llama al cliente. La pantalla del administrador dice cuánto se
 * está perdiendo; esta dice a quién llamar mañana, con el nombre delante.
 */

export const dynamic = 'force-dynamic';

export default async function AstaCarteraPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getAstaCartera(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Mis ventas">
        <PestanasReportes actual="clientes" />
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

  const { filas, totales } = datos;

  if (filas.length === 0) {
    return (
      <Marco usuario={sesion.usuario} titulo="Mis ventas">
        <PestanasReportes actual="clientes" />
        <div className="empty">Ningún cliente tuyo compra consumibles todavía.</div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Mis ventas">
      <PestanasReportes actual="clientes" />
      <section className="stats">
        <Cifra icono="ventas" color="verde" etiqueta="Vendido en ASTA" valor={moneyCompact(totales.asta)} nota="histórico, sin IVA" />
        <Cifra icono="clientes" etiqueta="Compran ASTA" valor={filas.filter((f) => f.asta > 0).length} nota="clientes tuyos que lo han comprado alguna vez" />
        <Cifra icono="diana" color="violeta" etiqueta="Nunca han comprado ASTA" valor={totales.sinAsta} nota="clientes tuyos que compran consumibles" />
      </section>

      <TablaAsta filas={filas} conVendedor={false} />
    </Marco>
  );
}
