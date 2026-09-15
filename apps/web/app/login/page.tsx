import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { destinoPara } from '@/lib/rutas';
import { setSession } from '@/lib/session';

/**
 * Login.
 *
 * La llamada al middleware ocurre en el SERVIDOR de Next (server action): la
 * contraseña nunca viaja desde el navegador a otro sitio que no sea este mismo
 * origen, y el token de respuesta no llega al cliente.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

interface Props {
  searchParams: Promise<{ error?: string; from?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;

  async function entrar(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    if (!email || !password) redirect('/login?error=faltan');

    let res: Response;
    try {
      /*
       * Se reenvían el navegador y la IP REALES de quien entra (issue #52).
       *
       * Sin esto, el middleware registra en la sesión lo que ve: el servidor de
       * Next. Y como el navegador nunca le habla directamente, TODAS las
       * sesiones salían como "Dispositivo desconocido" desde la misma IP, lo que
       * dejaba la pantalla de sesiones activas sin nada que mirar — y esa
       * pantalla existe justo para reconocer un acceso que no es tuyo.
       *
       * El middleware solo se cree estas dos cabeceras si quien llama está en su
       * TRUSTED_PROXIES. De lo contrario cualquiera podría escribir a mano el
       * dispositivo y la IP que quedan registrados.
       */
      const cabeceras = await headers();
      const ipCliente = cabeceras.get('x-forwarded-for') ?? cabeceras.get('x-real-ip') ?? '';

      res = await fetch(`${MIDDLEWARE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Asta-Client-UA': cabeceras.get('user-agent') ?? '',
          // Se pasa la cadena TAL CUAL llegó, sin reescribirla: si delante hay
          // otro proxy, el primer salto de la lista es el cliente real y
          // sustituirla lo perdería. En desarrollo no hay proxy y viene vacía,
          // así que la IP registrada será la de loopback — es lo que hay, y es
          // preferible a inventarse una.
          'X-Forwarded-For': ipCliente,
        },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      redirect('/login?error=red');
    }

    if (!res.ok) {
      const cuerpo = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const msg = cuerpo?.error?.message ?? '';
      // El bloqueo se distingue porque el usuario necesita saber que esperar le
      // sirve de algo. El resto de fallos comparten mensaje a propósito.
      redirect(`/login?error=${/bloquead/i.test(msg) ? 'bloqueada' : 'credenciales'}`);
    }

    const { data } = (await res.json()) as {
      data: {
        accessToken: string;
        expiraEn: number;
        usuario: { id: string; nombre: string; role: string };
      };
    };

    // El refresh token viene en la cookie que puso el middleware; hay que
    // extraerlo para guardarlo en el dominio del panel.
    const refreshToken =
      res.headers
        .getSetCookie?.()
        ?.find((c) => c.startsWith('asta_rt='))
        ?.split(';')[0]
        ?.slice('asta_rt='.length) ?? '';

    await setSession({
      accessToken: data.accessToken,
      refreshToken,
      expiraEn: data.expiraEn,
      usuario: data.usuario,
    });

    // La regla vive en un solo sitio: ver `lib/rutas.ts`.
    redirect(destinoPara(data.usuario.role));
  }

  const MENSAJES: Record<string, string> = {
    credenciales: 'Correo o contraseña incorrectos.',
    bloqueada: 'Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo en unos minutos.',
    faltan: 'Escribe tu correo y tu contraseña.',
    red: 'No se pudo contactar con el servidor. Comprueba que el middleware esté arriba.',
    cerrada: 'Tu sesión se cerró. Vuelve a entrar.',
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>ASTA · Panel de vendedores</h1>
        <p>Cartera y facturación, en vivo desde Odoo.</p>

        {error && (
          <div className="notice error" style={{ marginBottom: 18, padding: '12px 14px' }}>
            <p style={{ margin: 0 }}>{MENSAJES[error] ?? 'No se pudo iniciar sesión.'}</p>
          </div>
        )}

        <form action={entrar}>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="btn">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
