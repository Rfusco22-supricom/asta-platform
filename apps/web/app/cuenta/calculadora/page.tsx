import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { getCalculadora, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Calculadora, type ProductoCalculadora } from './Calculadora';

/**
 * «Calculadora de ganancia»: cuánto gana el cliente vendiendo ASTA, con los
 * precios de su tarifa. Ver `Calculadora`.
 *
 * Solo ASTA (decidido con Supricom el 2026-11-10): el middleware devuelve
 * parejas ASTA–original, y aquí, en el servidor, se quedan solo los productos
 * ASTA (uno por producto). Lo del original no llega al navegador.
 */

/** De las parejas, los productos ASTA, sin repetir. Solo los que se llaman ASTA: en Odoo hay originales con la marca mal puesta. */
function soloAsta(parejas: Awaited<ReturnType<typeof getCalculadora>>['parejas']): ProductoCalculadora[] {
  const vistos = new Map<number, ProductoCalculadora>();
  for (const p of parejas) {
    if (vistos.has(p.asta.productId) || !/\bASTA\b/i.test(p.asta.nombre)) continue;
    vistos.set(p.asta.productId, { productId: p.asta.productId, sku: p.asta.sku, nombre: p.asta.nombre, precio: p.asta.precio, compraMensual: p.compraMensualAsta });
  }
  // Primero los que ya compra (de más a menos); luego por nombre.
  return [...vistos.values()].sort((a, b) => b.compraMensual - a.compraMensual || a.nombre.localeCompare(b.nombre));
}

export const dynamic = 'force-dynamic';

export default async function CalculadoraPage({ searchParams }: { searchParams: Promise<{ elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Ver su panel»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo="Calculadora de ganancia">
        <ElegirCliente token={sesion.accessToken} destino="/cuenta/calculadora" />
      </Marco>
    );
  }
  const cliente = comoCliente?.id ?? null;
  let datos;
  try {
    datos = await getCalculadora(sesion.accessToken, cliente);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Calculadora de ganancia">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudo abrir la calculadora'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }
  return (
    <Marco usuario={sesion.usuario} titulo="Calculadora de ganancia">
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/calculadora" />}
      <p className="panel-nota" style={{ marginTop: 0 }}>
        Cuánto ganas vendiendo ASTA, con los precios de tu tarifa. Elige un producto y mueve tu margen.
      </p>
      <Calculadora productos={soloAsta(datos.parejas)} />
    </Marco>
  );
}
