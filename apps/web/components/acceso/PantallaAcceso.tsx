/**
 * El marco de las pantallas de acceso: entrar, olvidé la contraseña, elegir una
 * nueva y aceptar una invitación.
 *
 * Es el MISMO para todos los que entran —administración, equipo de ventas y
 * clientes—, así que no dice de quién es: la marca a un lado y el formulario al
 * otro. A dónde va cada uno lo decide su rol después de entrar (`lib/rutas.ts`).
 *
 * El panel de la marca es decoración: va oculto a los lectores de pantalla, y
 * en pantallas estrechas se reduce a una franja con el logo para que el
 * formulario quede a la vista sin desplazarse.
 */
export function PantallaAcceso({ children }: { children: React.ReactNode }) {
  return (
    <div className="acceso">
      <aside className="acceso-marca" aria-hidden="true">
        <div className="acceso-aurora">
          <span />
          <span />
          <span />
        </div>
        <div className="acceso-marca-contenido">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático en /public */}
          <img src="/asta-logo-blanco.png" alt="" className="acceso-logo" />
          <p className="acceso-lema">
            Todo lo de tu cuenta,
            <br />
            en un solo lugar.
          </p>
        </div>
        <p className="acceso-pie">Asta · {new Date().getFullYear()}</p>
      </aside>

      <main className="acceso-panel">
        <div className="login-card acceso-tarjeta">
          {children}
        </div>
      </main>
    </div>
  );
}
