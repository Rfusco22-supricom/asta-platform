import Link from 'next/link';
import type { VistaCliente } from '@/lib/vistaCliente';
import { PANTALLAS_VISTA_CLIENTE } from '@/lib/navegacion';
import { PestanasSeccion } from '@/components/PestanasSeccion';

/**
 * Arriba de cada pantalla del cliente cuando la mira el administrador: de quién
 * es, que es solo para mirar, y sus pantallas como pestañas (ya no están en el
 * menú: se llega desde «Ver su panel» en la ficha del cliente).
 */
export function BannerVista({ vista, destino }: { vista: VistaCliente; destino: string }) {
  return (
    <>
      <div className="vista-banner" role="status">
        <span>
          Estás viendo el panel de <strong data-privado>{vista.nombre}</strong> tal como lo ve él · <b>solo lectura</b>
        </span>
        <span className="vista-banner-acciones">
          <Link href={`/cartera/${vista.id}`}>Volver a su ficha</Link>
          <Link href={`${destino}?elegir=1`}>Cambiar cliente</Link>
          <a href="/api/vista-cliente?salir=1">Salir</a>
        </span>
      </div>
      <PestanasSeccion etiqueta="Pantallas del cliente" pestanas={PANTALLAS_VISTA_CLIENTE} actual={destino} />
    </>
  );
}
