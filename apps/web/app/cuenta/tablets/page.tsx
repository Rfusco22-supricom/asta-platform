import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getTabletsPropias, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Tablets } from './Tablets';

/**
 * Mis tablets: el cliente vincula tablets de SU tienda con la aplicación ASTA.
 *
 * Enseñan qué tóner le sirve a cada impresora, sin existencias ni precios: la
 * tablet no tiene almacén. Se vinculan con un código de 6 dígitos que se pide
 * aquí y se escribe (o se escanea) en la tablet.
 *
 * Los enlaces de descarga salen de `APP_IOS_URL` y `APP_ANDROID_URL`: mientras
 * la aplicación no esté publicada, no se enseñan.
 */

export const dynamic = 'force-dynamic';

export default async function TabletsPage() {
  const sesion = await requireSession();

  let tablets;
  try {
    tablets = (await getTabletsPropias(sesion.accessToken)).data;
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Mis tablets">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es para clientes' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const descargas = { ios: process.env.APP_IOS_URL || null, android: process.env.APP_ANDROID_URL || null };

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Mis tablets"
      descripcion="La aplicación ASTA en las tablets de tu tienda: tus clientes buscan su impresora y ven qué tóner le sirve."
    >
      <Tablets inicial={tablets} descargas={descargas} />
    </Marco>
  );
}
