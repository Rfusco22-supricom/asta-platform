import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getAlmacenesKiosco, getCodigoRevision, getKioscos, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Kioscos } from './Kioscos';

/**
 * Kioscos: las tablets de las tiendas (#40, #120).
 *
 * Cada tablet se da de alta aquí con su tienda y su almacén, y recibe su
 * propio token: no una API key de cliente. El token solo abre el recomendador,
 * y las existencias que enseña son las de ese almacén.
 */

export const dynamic = 'force-dynamic';

export default async function KioscosPage() {
  const sesion = await requireSession();

  let datos;
  try {
    const [kioscos, revision, almacenes] = await Promise.all([
      getKioscos(sesion.accessToken),
      getCodigoRevision(sesion.accessToken),
      // Sin Odoo no se puede dar de alta (hay que elegir el almacén), pero la
      // lista de tablets se ve igual.
      getAlmacenesKiosco(sesion.accessToken).catch((e) => {
        if (esRedireccion(e)) throw e;
        return null;
      }),
    ]);
    datos = { kioscos, revision, almacenes };
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Tablets">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Tablets">
      <Kioscos
        inicial={datos.kioscos.data}
        revisionInicial={datos.revision}
        almacenes={datos.almacenes}
      />
    </Marco>
  );
}
