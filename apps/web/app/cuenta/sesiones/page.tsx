import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getSesiones, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Sesiones } from './Sesiones';

/**
 * Sesiones activas (issue #52).
 *
 * Responde a una sola pregunta, y conviene que no responda a ninguna más:
 * ¿hay alguien más dentro de mi cuenta?
 *
 * Existe porque la detección de reuso de refresh tokens, que ya funcionaba, era
 * invisible: el sistema revocaba la familia entera de sesiones y la persona solo
 * veía que la habían echado, sin saber desde dónde ni por qué. Aquí puede mirar
 * la lista, reconocer sus dispositivos y cerrar el que no reconozca.
 *
 * Está fuera de `/admin` a propósito: no es una herramienta de administración
 * sino de cada cual sobre su propia cuenta, y por eso la puede ver cualquier rol.
 */

export const dynamic = 'force-dynamic';

export default async function SesionesPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getSesiones(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga y
    // el usuario ve "no se pudo cargar" en vez de ir al login.
    if (esRedireccion(error)) throw error;
    return (
      <Marco usuario={sesion.usuario} titulo="Sesiones activas">
        <div className="notice error">
          <h2>No se pudieron cargar las sesiones</h2>
          <p>
            {error instanceof ApiError || error instanceof ContractError
              ? error.message
              : 'Error inesperado.'}
          </p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco usuario={sesion.usuario} titulo="Sesiones activas">
      {/* El instante de referencia se fija AQUÍ, en el servidor, y baja como
          prop. Si cada lado leyera su propio reloj, los textos de "hace X min"
          no coincidirían y la hidratación fallaría. */}
      <Sesiones filas={datos.filas} otras={datos.otras} ahora={Date.now()} />
    </Marco>
  );
}
