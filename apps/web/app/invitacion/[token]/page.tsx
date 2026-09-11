import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { LONGITUD_MINIMA_CONTRASENA } from '@asta/shared-types';

/**
 * Aceptación de invitación (issue #16).
 *
 * Página PÚBLICA: quien llega aquí todavía no tiene contraseña, así que no
 * puede autenticarse. El token del enlace es la credencial.
 *
 * Se valida en el servidor antes de pintar nada. Enseñar el formulario y
 * descubrir al enviarlo que el enlace caducó es hacerle escribir una contraseña
 * para tirarla a la basura.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

const validacionSchema = z.object({
  data: z.object({
    email: z.string(),
    nombre: z.string(),
    yaTieneContrasena: z.boolean(),
  }),
});

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function InvitacionPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { error } = await searchParams;

  let datos: z.infer<typeof validacionSchema>['data'] | null = null;
  let motivo: string | null = null;

  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/invitation/${token}`, {
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    if (res.ok) {
      const p = validacionSchema.safeParse(body);
      if (p.success) datos = p.data.data;
      else motivo = 'El servidor devolvió una respuesta inesperada.';
    } else {
      motivo = body?.error?.message ?? 'Esta invitación no es válida.';
    }
  } catch {
    motivo = 'No se pudo contactar con el servidor. Inténtalo en unos minutos.';
  }

  async function aceptar(formData: FormData) {
    'use server';
    const password = String(formData.get('password') ?? '');
    const repetir = String(formData.get('repetir') ?? '');

    if (password !== repetir) {
      redirect(`/invitacion/${token}?error=${encodeURIComponent('Las contraseñas no coinciden.')}`);
    }

    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/invitation/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message ?? 'No se pudo establecer la contraseña.';
      redirect(`/invitacion/${token}?error=${encodeURIComponent(msg)}`);
    }

    redirect('/login?bienvenida=1');
  }

  if (!datos) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Invitación no válida</h1>
          <p>{motivo}</p>
          <div className="notice" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>
              Los enlaces de invitación caducan a los 7 días y solo se pueden usar una vez.
              Pídele uno nuevo a tu contacto en ASTA.
            </p>
          </div>
          <p style={{ marginTop: 18, marginBottom: 0 }}>
            <Link href="/login">Ir al inicio de sesión</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{datos.yaTieneContrasena ? 'Cambia tu contraseña' : 'Bienvenido a ASTA'}</h1>
        <p>
          Estás configurando el acceso de <strong>{datos.nombre}</strong> ({datos.email}).
        </p>

        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        )}

        <form action={aceptar}>
          <div className="field">
            <label htmlFor="password">Contraseña nueva</label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              required
              minLength={LONGITUD_MINIMA_CONTRASENA}
              autoComplete="new-password"
            />
            {/* Se dice la regla ANTES de escribir, no después de rechazarla. */}
            <div className="hint">
              Al menos {LONGITUD_MINIMA_CONTRASENA} caracteres. Una frase que recuerdes es
              mejor que algo corto y retorcido.
            </div>
          </div>

          <div className="field">
            <label htmlFor="repetir">Repítela</label>
            <input
              id="repetir"
              name="repetir"
              type="password"
              className="input"
              required
              minLength={LONGITUD_MINIMA_CONTRASENA}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn">
            Establecer contraseña
          </button>
        </form>

        <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12.5, color: 'var(--text-3)' }}>
          Este enlace solo funciona una vez. Si ya tenías sesión abierta en algún
          dispositivo, se cerrará.
        </p>
      </div>
    </div>
  );
}
