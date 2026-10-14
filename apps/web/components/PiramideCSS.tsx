import { COLORES_CATEGORIAS } from './tres/colores';

/**
 * La pirámide de categorías en relieve, solo con CSS: cinco losas apiladas con
 * `transform-style: preserve-3d`, de Cliente general abajo a Diamante arriba.
 *
 * Es la hermana ligera de `PiramideCristal` (three.js), para las pantallas que
 * no llevan 3D de verdad: no descarga nada, no usa la GPU más allá de la
 * composición y se pinta en el servidor. Gira despacio; con «reducir
 * movimiento» se queda quieta.
 *
 * `activo` ilumina una losa (0 = la de abajo) y apaga las demás: en el portal
 * del cliente, la de su nivel.
 */

const LADOS = [150, 122, 94, 66, 38];
const ALTO = 14;
const PASO = 20;

/** Un color un poco más oscuro, para las caras laterales. */
function sombra(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * factor).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export function PiramideCSS({ activo = null }: { activo?: number | null }) {
  return (
    <div className="piramide-css" aria-hidden="true">
      <div className="piramide-css-giro">
        {LADOS.map((lado, i) => {
          const color = COLORES_CATEGORIAS[i]!;
          const borde = (LADOS[0]! - lado) / 2;
          const apagada = activo !== null && activo !== i;
          return (
            <div
              key={lado}
              className={`losa${activo === i ? ' losa-activa' : ''}${apagada ? ' losa-apagada' : ''}`}
              style={
                {
                  left: borde,
                  top: borde,
                  width: lado,
                  height: lado,
                  '--z': `${i * PASO}px`,
                  '--alto': `${ALTO}px`,
                  '--techo': color,
                  '--frente': sombra(color, 0.72),
                  '--lado': sombra(color, 0.86),
                } as React.CSSProperties
              }
            >
              <span className="losa-techo" />
              <span className="losa-frente" />
              <span className="losa-fondo" />
              <span className="losa-derecha" />
              <span className="losa-izquierda" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
