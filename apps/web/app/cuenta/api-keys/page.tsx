import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession, clearSession } from '@/lib/session';
import { getApiKeys, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { ApiKeys } from './ApiKeys';

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

async function salir() {
  'use server';
  await clearSession();
  redirect('/login');
}

function Marco({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          ASTA<span>Mi cuenta</span>
        </div>
        <div className="topbar-right">
          <span className="who">
            <strong>{nombre}</strong>
          </span>
          <form action={salir}>
            <button type="submit" className="btn-link">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}

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
        <Marco nombre={sesion.usuario.nombre}>
          <div className="notice">
            <h2>Esta pantalla es para clientes</h2>
            <p>
              Las API keys sirven para que un cliente conecte su propio sistema
              con ASTA. Los datos que necesitas los tienes en el panel.
            </p>
            <p style={{ marginTop: 12 }}>
              <Link href="/" className="btn-link">
                ← Volver
              </Link>
            </p>
          </div>
        </Marco>
      );
    }

    return (
      <Marco nombre={sesion.usuario.nombre}>
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
    <Marco nombre={sesion.usuario.nombre}>
      <div className="page-head">
        <h1>Mis API keys</h1>
        <p>
          Para conectar tu sistema con ASTA y consultar tus facturas, el
          catálogo y tus existencias sin entrar aquí.
        </p>
      </div>

      <ApiKeys filas={datos.filas} vivas={datos.vivas} maximo={datos.maximo} />

      <p style={{ marginTop: 24, fontSize: 13 }}>
        <Link href="/cuenta/sesiones" className="btn-link">
          Sesiones activas
        </Link>
      </p>
    </Marco>
  );
}
