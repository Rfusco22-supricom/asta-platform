import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getImpulsa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';
import { ListaImpulsa } from './ListaImpulsa';

/**
 * «Impulsa a tus clientes» (#40): qué ofrecer hoy, cliente por cliente.
 *
 * Primera acción, «Pásale a ASTA»: el cliente compra un consumible de otra marca
 * que tiene un equivalente ASTA con existencias en su almacén. Las sugerencias
 * se calculan en el middleware sobre la cartera del token; aquí solo se pintan
 * y se marcan.
 */

export const dynamic = 'force-dynamic';

export default async function ImpulsaPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getImpulsa(sesion.accessToken);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Impulsa a tus clientes">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta pantalla es para vendedores' : 'No se pudieron calcular las sugerencias'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const { pendientes } = datos.meta;

  return (
    <Marco usuario={sesion.usuario} titulo="Impulsa a tus clientes">
      <section className="stats">
        <Cifra icono="clientes" color="verde" etiqueta="Clientes para pasar a ASTA" valor={pendientes.clientes} nota="con sugerencias pendientes" />
        <Cifra
          icono="idea"
          color="violeta"
          etiqueta="Sugerencias"
          valor={pendientes.sugerencias}
          nota={datos.meta.atendidas > 0 ? `${datos.meta.atendidas} ya atendidas` : 'ninguna atendida todavía'}
        />
        <Cifra icono="juego" color="ambar" etiqueta="En juego" valor={moneyCompact(pendientes.enJuego)} nota="en otras marcas, últimos 12 meses" />
      </section>


      <ListaImpulsa clientes={datos.data} />
    </Marco>
  );
}
