import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getReconciliacion, getSinAcceso, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Invitaciones } from '../Invitaciones';

/**
 * Usuarios: quién tiene cuenta y todavía no puede entrar.
 *
 * ── Por qué es una sección propia ────────────────────────────────────────────
 *
 * Estaba embutida en el informe de reconciliación, y solo aparecía si el
 * contador de «sin credenciales» era mayor que cero. Eso la hacía invisible
 * justo cuando alguien la buscaba a propósito: quien entra pensando «tengo que
 * invitar a fulano» no va a un informe de reconciliación a ver si hoy sale el
 * bloque.
 *
 * Con la barra lateral tiene sitio fijo, y el caso de cero deja de ser «no sale
 * nada» para ser una frase que dice que no hay nadie pendiente.
 *
 * Hoy solo invita. Crear, editar y desactivar irán aquí cuando existan.
 */

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
  const sesion = await requireSession();

  let candidatos: Awaited<ReturnType<typeof getSinAcceso>>['filas'] = [];
  let total = 0;

  try {
    /*
     * Solo la lista, que ya trae su total.
     *
     * Aquí se pedía TAMBIÉN el informe de reconciliación, únicamente para sacar
     * el contador. Ese informe recorre Odoo entero y está limitado por
     * frecuencia, así que al separar esta sección las dos pantallas se lo
     * pedían y la segunda respondía «Espera unos minutos entre
     * sincronizaciones». Un contador no puede costar un barrido del ERP.
     */
    const r = await getSinAcceso(sesion.accessToken, 25);
    candidatos = r.filas;
    total = r.total;
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Usuarios">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>
            {error instanceof ContractError || error instanceof ApiError
              ? error.message
              : 'Error inesperado.'}
          </p>
        </div>
      </Marco>
    );
  }

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Usuarios"
      descripcion="Cuentas que existen en el panel pero todavía no pueden entrar, porque nadie les ha puesto contraseña."
    >
      {total === 0 ? (
        <div className="notice">
          <h2>No hay nadie pendiente</h2>
          <p>
            Todas las cuentas activas tienen contraseña. Cuando el sync cree alguna nueva, aparecerá
            aquí.
          </p>
        </div>
      ) : (
        <Invitaciones candidatos={candidatos} total={total} />
      )}
    </Marco>
  );
}
