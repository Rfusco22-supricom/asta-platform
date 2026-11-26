import { getClientesAdmin, getPortfolio, esRedireccion } from '@/lib/api';
import { BuscadorClientes } from './BuscadorClientes';

/**
 * «Ver su panel», sin cliente elegido: a quién mirar.
 *
 *   · El administrador: la lista de la paleta ⌘K (todos los clientes con cuenta).
 *   · El vendedor: su cartera, con cuenta o sin ella: así puede enseñarle el
 *     panel a un cliente antes de invitarlo. El middleware no le deja ver otros.
 *
 * Se filtra en el navegador.
 */
export async function ElegirCliente({ token, rol, destino }: { token: string; rol: string; destino: string }) {
  const esVendedor = rol === 'VENDEDOR';
  let clientes: { id: number; nombre: string; nivel: string }[] = [];
  try {
    clientes = esVendedor
      ? (await getPortfolio(token)).filas.map((f) => ({ id: f.id, nombre: f.nombre, nivel: f.tierDerivado }))
      : await getClientesAdmin(token);
  } catch (error) {
    if (esRedireccion(error)) throw error;
  }
  return (
    <section className="panel vista-elegir">
      <h2>¿El panel de qué cliente quieres ver?</h2>
      <p className="panel-nota">
        {esVendedor
          ? 'Para hacerle la demostración: lo verás tal como lo ve él, sin poder cambiar nada. Se queda elegido mientras recorres sus pantallas.'
          : 'Lo verás tal como lo ve él, sin poder cambiar nada. Se queda elegido mientras recorres sus pantallas.'}
      </p>
      {clientes.length === 0 ? (
        <div className="empty">No se pudo leer la lista de clientes. Recarga en un momento.</div>
      ) : (
        <BuscadorClientes clientes={clientes} destino={destino} queLista={esVendedor ? 'clientes de tu cartera' : 'clientes con cuenta'} />
      )}
    </section>
  );
}
