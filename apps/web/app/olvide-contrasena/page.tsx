import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { esRedireccion } from '@/lib/api';

/**
 * «Olvidé mi contraseña» (#53). Página PÚBLICA.
 *
 * Diga lo que diga el middleware, aquí se enseña siempre el mismo mensaje: si
 * cambiara según exista o no la cuenta, la página serviría para averiguar qué
 * correos están registrados.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

interface Props {
  searchParams: Promise<{ enviado?: string; error?: string }>;
}

export default async function OlvideContrasenaPage({ searchParams }: Props) {
  const { enviado, error } = await searchParams;

  async function pedir(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect('/olvide-contrasena?error=falta');

    try {
      // La IP real de quien pide, como en el login: el límite por IP del
      // middleware tiene que contar a cada persona, no al servidor de Next.
      const cabeceras = await headers();
      const res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': cabeceras.get('x-forwarded-for') ?? cabeceras.get('x-real-ip') ?? '',
        },
        body: JSON.stringify({ email }),
        cache: 'no-store',
      });
      if (res.status === 429) redirect('/olvide-contrasena?error=limite');
      if (!res.ok) redirect('/olvide-contrasena?error=red');
    } catch (e) {
      // `redirect()` funciona lanzando: no hay que tragárselo.
      if (esRedireccion(e)) throw e;
      redirect('/olvide-contrasena?error=red');
    }
    redirect('/olvide-contrasena?enviado=1');
  }

  const ERRORES: Record<string, string> = {
    falta: 'Escribe tu correo.',
    limite: 'Has pedido demasiados enlaces seguidos. Espera un rato y vuelve a intentarlo.',
    red: 'No se pudo contactar con el servidor. Inténtalo en unos minutos.',
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>¿Olvidaste tu contraseña?</h1>

        {enviado ? (
          <>
            <div className="notice" style={{ marginBottom: 16 }}>
              <p style={{ margin: 0 }}>
                Si esa dirección tiene cuenta, recibirás un correo con un enlace para elegir una contraseña nueva.
                Caduca en una hora y solo sirve una vez.
              </p>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              Si no llega en unos minutos, mira en la carpeta de spam. ¿Sigue sin llegar? Pide acceso a tu contacto en
              ASTA.
            </p>
          </>
        ) : (
          <>
            <p>Escribe el correo de tu cuenta y te mandamos un enlace para elegir una contraseña nueva.</p>

            {error && (
              <div className="notice error" style={{ marginBottom: 16 }}>
                <p style={{ margin: 0 }}>{ERRORES[error] ?? 'No se pudo enviar.'}</p>
              </div>
            )}

            <form action={pedir}>
              <div className="field">
                <label htmlFor="email">Correo</label>
                <input id="email" name="email" type="email" className="input" autoComplete="username" autoFocus required />
              </div>
              <button type="submit" className="btn">
                Enviar enlace
              </button>
            </form>

            {/* El personal tiene otro camino, y es el más corto. */}
            <p className="login-ayuda">
              <strong>Equipo de ventas:</strong> puedes entrar con tu usuario y contraseña de Odoo. Si la olvidaste,
              recupérala en Odoo.
            </p>
          </>
        )}

        <p style={{ marginTop: 18, marginBottom: 0 }}>
          <Link href="/login">Volver al inicio de sesión</Link>
        </p>
      </div>
    </div>
  );
}
