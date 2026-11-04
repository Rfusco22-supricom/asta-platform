import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { getDatosFlyer, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { EditorFlyer } from './EditorFlyer';

/**
 * «Mis flyers»: flyers de ASTA con los datos de su tienda, para Instagram o
 * WhatsApp. Es el «banco de flyers» del kit de bienvenida. Ver `EditorFlyer`.
 */

export const dynamic = 'force-dynamic';

export default async function FlyersPage({ searchParams }: { searchParams: Promise<{ elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Usuarios»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo="Mis flyers">
        <ElegirCliente token={sesion.accessToken} destino="/cuenta/flyers" />
      </Marco>
    );
  }
  const cliente = comoCliente?.id ?? null;
  let datos;
  try {
    datos = await getDatosFlyer(sesion.accessToken, cliente);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Mis flyers">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudieron cargar tus flyers'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }
  return (
    <Marco usuario={sesion.usuario} titulo="Mis flyers">
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/flyers" />}
      <p className="panel-nota" style={{ marginTop: 0 }}>
        Elige una plantilla, revisa los datos de tu tienda y descarga la imagen para publicarla en Instagram o WhatsApp.
      </p>
      <EditorFlyer datos={datos} />
    </Marco>
  );
}
