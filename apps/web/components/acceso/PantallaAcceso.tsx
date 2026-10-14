import { COLORES_CATEGORIAS } from '../tres/colores';
import { PiramideCristal } from '../tres/PiramideCristal';

/**
 * El marco de las pantallas de acceso: entrar, olvidé la contraseña, elegir una
 * nueva y aceptar una invitación.
 *
 * Es el MISMO para todos los que entran —administración, equipo de ventas y
 * clientes—, así que no dice de quién es: la marca a un lado y el formulario al
 * otro. A dónde va cada uno lo decide su rol después de entrar (`lib/rutas.ts`).
 *
 * La marca lleva la pirámide de categorías de ASTA en 3D (`PiramideCristal`):
 * se mueve con el ratón y se puede girar. Es decoración y va oculta a los
 * lectores de pantalla; en pantallas estrechas se reduce a una franja para que
 * el formulario quede a la vista sin desplazarse.
 */

const NIVELES = ['Cliente general', 'Bronce', 'Plata', 'Oro', 'Diamante'];

export function PantallaAcceso({ children }: { children: React.ReactNode }) {
  return (
    <div className="acceso">
      <aside className="acceso-marca" aria-hidden="true">
        <PiramideCristal className="acceso-escena" desplazamiento={1.3} centroY={-0.4} />
        <span className="acceso-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático en /public */}
          <img src="/asta-logo.png" alt="" />
        </span>
        <div className="acceso-marca-contenido">
          <p className="acceso-lema">Todo lo de tu cuenta, en un solo lugar.</p>
          <ul className="acceso-niveles">
            {NIVELES.map((n, i) => (
              <li key={n} style={{ '--c': COLORES_CATEGORIAS[i] } as React.CSSProperties}>
                <i />
                {n}
              </li>
            )).reverse()}
          </ul>
          <p className="acceso-pie">ASTA · {new Date().getFullYear()}</p>
        </div>
      </aside>

      <main className="acceso-panel">
        <div className="login-card acceso-tarjeta">{children}</div>
      </main>
    </div>
  );
}
