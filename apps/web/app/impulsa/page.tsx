import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getImpulsa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { fecha, money, moneyCompact } from '@/lib/formato';
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

  const { pendientes, ventana, reglas } = datos.meta;

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Impulsa a tus clientes"
      descripcion={`Qué ofrecer hoy · compras del ${fecha(ventana.desde)} al ${fecha(ventana.hasta)}`}
    >
      <section className="stats">
        <div className="stat">
          <div className="stat-label">Clientes para pasar a ASTA</div>
          <div className="stat-value">{pendientes.clientes}</div>
          <div className="stat-sub">con sugerencias pendientes</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sugerencias</div>
          <div className="stat-value">{pendientes.sugerencias}</div>
          <div className="stat-sub">{datos.meta.atendidas > 0 ? `${datos.meta.atendidas} ya atendidas` : 'ninguna atendida todavía'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">En juego</div>
          <div className="stat-value">{moneyCompact(pendientes.enJuego)}</div>
          <div className="stat-sub">{money(pendientes.enJuego)} en otras marcas, sin IVA</div>
        </div>
      </section>

      <p className="panel-nota">
        Clientes que compran un consumible de otra marca, {money(reglas.montoMinimo)} o más en el año y la última vez en los
        últimos {reglas.diasDesdeUltimaCompra} días, para el que hay un ASTA equivalente con existencias en su almacén.
      </p>

      <ListaImpulsa clientes={datos.data} />
    </Marco>
  );
}
