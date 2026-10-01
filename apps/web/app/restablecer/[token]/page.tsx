import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { LONGITUD_MINIMA_CONTRASENA } from '@asta/shared-types';

/**
 * Elegir contraseña nueva desde el enlace del correo (#53).
 *
 * Página PÚBLICA, como la de invitación: el token del enlace es la credencial.
 * Se valida antes de pintar el formulario, para no hacer escribir una
 * contraseña que se va a tirar porque el enlace ya caducó.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

const validacionSchema = z.object({ data: z.object({ email: z.string(), nombre: z.string() }) });

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function RestablecerPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { error } = await searchParams;

  let datos: z.infer<typeof validacionSchema>['data'] | null = null;
  let motivo: string | null = null;

  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/reset-password/${token}`, { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (res.ok) {
      const p = validacionSchema.safeParse(body);
      if (p.success) datos = p.data.data;
      else motivo = 'El servidor devolvió una respuesta inesperada.';
    } else {
      motivo = body?.error?.message ?? 'Este enlace no es válido.';
    }
  } catch {
    motivo = 'No se pudo contactar con el servidor. Inténtalo en unos minutos.';
  }

  async function restablecer(formData: FormData) {
    'use server';
    const password = String(formData.get('password') ?? '');
    const repetir = String(formData.get('repetir') ?? '');

    if (password !== repetir) {
      redirect(`/restablecer/${token}?error=${encodeURIComponent('Las contraseñas no coinciden.')}`);
    }

    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/reset-password/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message ?? 'No se pudo cambiar la contraseña.';
      redirect(`/restablecer/${token}?error=${encodeURIComponent(msg)}`);
    }

    redirect('/login?aviso=restablecida');
  }

  if (!datos) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Enlace no válido</h1>
          <p>{motivo}</p>
          <div className="notice" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>
              Los enlaces para cambiar la contraseña caducan en una hora y solo se pueden usar una vez.
            </p>
          </div>
          <p style={{ marginTop: 18, marginBottom: 0 }}>
            <Link href="/olvide-contrasena">Pedir un enlace nuevo</Link> · <Link href="/login">Ir al inicio de sesión</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Elige tu contraseña nueva</h1>
        <p>
          Para la cuenta de <strong>{datos.nombre}</strong> ({datos.email}).
        </p>

        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        )}

        <form action={restablecer}>
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
            <div className="hint">
              Al menos {LONGITUD_MINIMA_CONTRASENA} caracteres. Una frase que recuerdes es mejor que algo corto y
              retorcido.
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
            Cambiar contraseña
          </button>
        </form>

        <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12.5, color: 'var(--text-3)' }}>
          Este enlace solo funciona una vez. Al cambiarla se cerrarán las sesiones abiertas en todos tus dispositivos.
        </p>
      </div>
    </div>
  );
}
