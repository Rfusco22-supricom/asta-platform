import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { destinoPara } from '@/lib/rutas';
import { setSession } from '@/lib/session';
import { BotonEnviar, CampoContrasena, IconoCorreo } from '@/components/acceso/CamposAcceso';
import { PantallaAcceso } from '@/components/acceso/PantallaAcceso';

/**
 * Login.
 *
 * La llamada al middleware ocurre en el SERVIDOR de Next (server action): la
 * contraseña nunca viaja desde el navegador a otro sitio que no sea este mismo
 * origen, y el token de respuesta no llega al cliente.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

interface Props {
  searchParams: Promise<{ error?: string; from?: string; aviso?: string; bienvenida?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, aviso, bienvenida } = await searchParams;

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
      // Odoo sin responder también se distingue: sin esto, quien entra con la
      // contraseña de Odoo leería «contraseña incorrecta» y la cambiaría para nada.
      redirect(`/login?error=${/bloquead/i.test(msg) ? 'bloqueada' : /odoo/i.test(msg) ? 'odoo' : 'credenciales'}`);
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
    // Lo lee también un cliente: nada de «middleware» aquí.
    red: 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos minutos.',
    cerrada: 'Tu sesión se cerró. Vuelve a entrar.',
    odoo: 'No se pudo comprobar tu contraseña con Odoo. Inténtalo en unos minutos, o entra con la contraseña del panel si tienes una.',
  };

  /*
   * Un solo login para todos —administración, equipo de ventas y clientes—:
   * por eso no dice de quién es. El rol decide a dónde se va al entrar.
   */
  return (
    <PantallaAcceso>
      <h1>Inicia sesión</h1>
      <p>Entra con el correo y la contraseña de tu cuenta.</p>

      {/* Al volver de elegir contraseña, por invitación o por reseteo (#53). */}
      {!error && (aviso === 'restablecida' || bienvenida) && (
        <div className="acceso-aviso ok" role="status">
          {aviso === 'restablecida' ? 'Contraseña cambiada. Entra con la nueva.' : 'Contraseña guardada. Ya puedes entrar.'}
        </div>
      )}

      {error && (
        <div className="acceso-aviso error" role="alert">
          {MENSAJES[error] ?? 'No se pudo iniciar sesión.'}
        </div>
      )}

      <form action={entrar}>
        <div className="field">
          <label htmlFor="email">Correo</label>
          <div className="acceso-entrada">
            <IconoCorreo />
            <input id="email" name="email" type="email" className="input" autoComplete="username" placeholder="tu@correo.com" autoFocus required />
          </div>
        </div>

        <div className="field">
          <div className="acceso-etiqueta">
            <label htmlFor="password">Contraseña</label>
            <Link href="/olvide-contrasena">¿La olvidaste?</Link>
          </div>
          <CampoContrasena id="password" name="password" autoComplete="current-password" />
        </div>

        <BotonEnviar enviando="Entrando…">Entrar</BotonEnviar>
      </form>

      {/*
        Sin esto, quien tiene la contraseña del panel y quien entra con la de
        Odoo no saben cuál escribir. Va aquí, para todos, y no en el error: en
        el error le diría a cualquiera qué cuentas tienen la verificación en
        dos pasos.
      */}
      <details className="acceso-ayuda">
        <summary>¿Problemas para entrar?</summary>
        <p>
          Si entras con tu usuario de Odoo y tienes activada la verificación en dos pasos, usa la contraseña del panel.
        </p>
        <p>
          Si todavía no tienes acceso, pide que te envíen una invitación. Llega por correo, con un enlace para elegir tu
          contraseña.
        </p>
      </details>
    </PantallaAcceso>
  );
}
