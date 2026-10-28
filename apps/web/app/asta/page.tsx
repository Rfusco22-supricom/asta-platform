import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getAstaCartera, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';
import { TablaAsta } from '../admin/asta/TablaAsta';
import { PestanasSeccion, PESTANAS_ASTA_VENDEDOR } from '@/components/PestanasSeccion';

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
      <Marco usuario={sesion.usuario} titulo="ASTA">
        <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_VENDEDOR} actual="/asta" />
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
      <Marco usuario={sesion.usuario} titulo="ASTA">
        <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_VENDEDOR} actual="/asta" />
        <div className="empty">Ningún cliente tuyo compra consumibles todavía.</div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="ASTA">
      <PestanasSeccion etiqueta="ASTA" pestanas={PESTANAS_ASTA_VENDEDOR} actual="/asta" />
      <section className="stats">
        <Cifra icono="cuota" color="rosa" etiqueta="Tu cuota de ASTA" valor={`${totales.cuota.toFixed(1)} %`} nota="del consumible que compran tus clientes" />
        <Cifra
          icono="juego"
          color="ambar"
          etiqueta="A la competencia"
          valor={moneyCompact(totales.competencia)}
          tono="alerta"
          nota="histórico · otras marcas"
        />
        <Cifra
          icono="diana"
          color="violeta"
          etiqueta="Sin probar ASTA"
          valor={totales.sinAsta}
          nota={`clientes tuyos · ${moneyCompact(totales.sinAstaImporte)} fuera, histórico`}
        />
      </section>

      <TablaAsta filas={filas} conVendedor={false} />
    </Marco>
  );
}
