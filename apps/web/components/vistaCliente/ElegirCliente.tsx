import { getClientesAdmin, esRedireccion } from '@/lib/api';
import { BuscadorClientes } from './BuscadorClientes';

/**
 * «Usuarios», sin cliente elegido: a quién mirar. La lista es la de la paleta
 * ⌘K (todos los clientes con cuenta); se filtra en el navegador.
 */
export async function ElegirCliente({ token, destino }: { token: string; destino: string }) {
  let clientes: { id: number; nombre: string; nivel: string }[] = [];
  try {
    clientes = await getClientesAdmin(token);
  } catch (error) {
    if (esRedireccion(error)) throw error;
  }
  return (
    <section className="panel vista-elegir">
      <h2>¿El panel de qué cliente quieres ver?</h2>
      <p className="panel-nota">Lo verás tal como lo ve él, sin poder cambiar nada. Se queda elegido mientras recorres sus pantallas.</p>
      {clientes.length === 0 ? <div className="empty">No se pudo leer la lista de clientes. Recarga en un momento.</div> : <BuscadorClientes clientes={clientes} destino={destino} />}
    </section>
  );
}
