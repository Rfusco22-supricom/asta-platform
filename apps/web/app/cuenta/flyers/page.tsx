import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getDatosFlyer, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { EditorFlyer } from './EditorFlyer';

/**
 * «Mis flyers»: flyers de ASTA con los datos de su tienda, para Instagram o
 * WhatsApp. Es el «banco de flyers» del kit de bienvenida. Ver `EditorFlyer`.
 */

export const dynamic = 'force-dynamic';

export default async function FlyersPage() {
  const sesion = await requireSession();
  let datos;
  try {
    datos = await getDatosFlyer(sesion.accessToken);
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
      <p className="panel-nota" style={{ marginTop: 0 }}>
        Elige una plantilla, revisa los datos de tu tienda y descarga la imagen para publicarla en Instagram o WhatsApp.
      </p>
      <EditorFlyer datos={datos} />
    </Marco>
  );
}
