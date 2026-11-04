import Link from 'next/link';
import type { VistaCliente } from '@/lib/vistaCliente';

/** Arriba de cada pantalla de «Usuarios»: de quién es y que es solo para mirar. */
export function BannerVista({ vista, destino }: { vista: VistaCliente; destino: string }) {
  return (
    <div className="vista-banner" role="status">
      <span>
        Estás viendo el panel de <strong>{vista.nombre}</strong> tal como lo ve él · <b>solo lectura</b>
      </span>
      <span className="vista-banner-acciones">
        <Link href={`${destino}?elegir=1`}>Cambiar cliente</Link>
        <a href="/api/vista-cliente?salir=1">Salir</a>
      </span>
    </div>
  );
}
