import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession, clearSession } from '@/lib/session';
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
      <Marco nombre={sesion.usuario.nombre}>
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

  const volverA = sesion.usuario.role === 'SUPERADMIN' ? '/admin' : '/cartera';

  return (
    <Marco nombre={sesion.usuario.nombre}>
      <div className="page-head">
        <h1>Sesiones activas</h1>
        <p>
          Dónde está abierta tu cuenta ahora mismo. Si ves algo que no
          reconoces, ciérralo y cambia tu contraseña.
        </p>
      </div>

      <Sesiones filas={datos.filas} otras={datos.otras} />

      <p style={{ marginTop: 24, fontSize: 13 }}>
        <Link href={volverA} className="btn-link">
          ← Volver
        </Link>
      </p>
    </Marco>
  );
}
