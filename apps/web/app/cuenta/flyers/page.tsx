import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';
import { COOKIE_PRESENTACION, presentacionDe } from '@/lib/presentacion';
import { Marco } from '@/components/Marco';
import { contextoCliente } from '@/lib/vistaCliente';
import { ElegirCliente } from '@/components/vistaCliente/ElegirCliente';
import { BannerVista } from '@/components/vistaCliente/BannerVista';
import { getDatosFlyer, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Anton } from 'next/font/google';
import { EditorFlyer } from './EditorFlyer';

/** La letra condensada del titular de la plantilla ASTA (la de Marketing). */
const anton = Anton({ weight: '400', subsets: ['latin'], display: 'swap' });

/**
 * «Mis flyers»: flyers de ASTA con los datos de su tienda, para Instagram o
 * WhatsApp. Es el «banco de flyers» del kit de bienvenida. Ver `EditorFlyer`.
 */

export const dynamic = 'force-dynamic';

export default async function FlyersPage({ searchParams }: { searchParams: Promise<{ elegir?: string }> }) {
  const sesion = await requireSession();
  // El administrador mira el panel de un cliente («Ver su panel»): primero, cuál.
  const { esAdmin, vista: comoCliente } = await contextoCliente(sesion);
  if (esAdmin && (!comoCliente || (await searchParams).elegir)) {
    return (
      <Marco usuario={sesion.usuario} titulo="Flyers">
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
      <Marco usuario={sesion.usuario} titulo="Flyers">
        <div className={esPermiso ? 'notice' : 'notice error'}>
          <h2>{esPermiso ? 'Esta pantalla es para clientes' : 'No se pudieron cargar tus flyers'}</h2>
          {!esPermiso && <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>}
        </div>
      </Marco>
    );
  }
  // En el modo presentación, la tienda sale en blanco: el flyer se dibuja en un
  // `canvas`, y lo que hay dentro no lo puede tapar `tapado.js`.
  if (presentacionDe((await cookies()).get(COOKIE_PRESENTACION)?.value)) {
    datos = { ...datos, tienda: { ...datos.tienda, nombre: '', telefono: null, direccion: null } };
  }
  return (
    <Marco usuario={sesion.usuario} titulo="Flyers">
      {comoCliente && <BannerVista vista={comoCliente} destino="/cuenta/flyers" />}
      <p className="panel-nota" style={{ marginTop: 0 }}>
        Elige una plantilla, revisa los datos de tu tienda y descarga la imagen para publicarla en Instagram o WhatsApp.
      </p>
      {/* Para que el navegador descargue la letra antes de dibujar el canvas. */}
      <span className={anton.className} aria-hidden="true" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
        ASTA
      </span>
      <EditorFlyer datos={datos} titular={anton.style.fontFamily} />
    </Marco>
  );
}
