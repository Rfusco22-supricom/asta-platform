import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getApiKeys, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { ROLE_LABEL, limpiarEspacios, type AppRole } from '@asta/shared-types';
import { PiramideCSS } from '@/components/PiramideCSS';
import { COLORES_CATEGORIAS } from '@/components/tres/colores';
import { ApiKeys } from './ApiKeys';

/** El nivel de la cuenta, en el orden de las losas de la pirámide (0 = abajo). */
const LOSA: Partial<Record<AppRole, number>> = { GENERAL: 0, BRONCE: 1, PLATA: 2, GOLD: 3, DIAMANTE: 4 };

/**
 * La bienvenida del portal de clientes: quién es, su nivel de ASTA (#131) con
 * la pirámide en relieve, y para qué sirve este portal. El nivel ya se ve en el
 * menú del usuario; aquí se ve dónde está dentro de la pirámide. Las reglas de
 * cada nivel NO se enseñan: las comunica Marketing.
 */
function Bienvenida({ nombre, rol }: { nombre: string; rol: string }) {
  const losa = LOSA[rol as AppRole] ?? null;
  return (
    <section className="panel bienvenida">
      <div className="bienvenida-texto">
        <span className="hero-etiqueta">Portal de clientes ASTA</span>
        <h2>Hola, {limpiarEspacios(nombre)}</h2>
        <p>
          Con una API key, tu sistema consulta el catálogo de ASTA, tus precios y tus facturas por su cuenta, sin que nadie tenga que
          entrar a este panel.
        </p>
        {losa !== null && (
          <span className="bienvenida-nivel" style={{ '--c': COLORES_CATEGORIAS[losa] } as React.CSSProperties}>
            <i aria-hidden="true" />
            Tu nivel ASTA: <strong>{ROLE_LABEL[rol as AppRole]}</strong>
          </span>
        )}
      </div>
      <PiramideCSS activo={losa} />
    </section>
  );
}

/**
 * Mis API keys (issue #28).
 *
 * ── Es la primera pantalla del panel para un CLIENTE ─────────────────────────
 *
 * Hasta ahora el panel era solo para el personal: `/cartera` es del vendedor y
 * `/admin` del SuperAdmin. Un BRONCE que entrara acababa en `/cartera` y recibía
 * un 403 nada más autenticarse, porque la matriz le niega `cartera.ver`.
 *
 * Por eso este cambio toca también el enrutado de la raíz: un cliente aterriza
 * aquí. No es que las API keys sean lo más importante para él —es que es lo
 * único suyo que hay construido todavía.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * La API pública lleva desplegada desde #32 y #30, y hasta ahora conseguir una
 * key era que alguien insertara una fila a mano. Una API que sus destinatarios
 * no pueden empezar a usar solos está construida pero no entregada.
 */

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getApiKeys(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga y
    // el usuario ve "no se pudo cargar" en vez de ir al login.
    if (esRedireccion(error)) throw error;

    /*
     * Un 403 aquí no es un fallo: es el personal entrando donde no le toca.
     * La matriz niega `apikeys.propias.gestionar` a VENDEDOR y a SUPERADMIN
     * porque una API key existe para que un CLIENTE conecte su sistema. Merece
     * un texto que lo explique, no un "no se pudieron cargar".
     */
    if (error instanceof ApiError && error.status === 403) {
      return (
        <Marco usuario={sesion.usuario} titulo="Mis API keys">
          <div className="notice">
            <h2>Esta pantalla es para clientes</h2>
            <p>
              Las API keys sirven para que un cliente conecte su propio sistema con ASTA. Los datos
              que necesitas los tienes en el panel.
            </p>
          </div>
        </Marco>
      );
    }

    return (
      <Marco usuario={sesion.usuario} titulo="Mis API keys">
        <div className="notice error">
          <h2>No se pudieron cargar tus API keys</h2>
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
    <Marco usuario={sesion.usuario} titulo="Mis API keys">
      <Bienvenida nombre={sesion.usuario.nombre} rol={sesion.usuario.role} />
      <ApiKeys filas={datos.filas} vivas={datos.vivas} maximo={datos.maximo} />
    </Marco>
  );
}
