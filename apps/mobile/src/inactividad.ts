/**
 * Temporizador de inactividad del kiosco (#40).
 *
 * La tablet vuelve sola a la pantalla de atracción cuando nadie la toca. No es
 * estética: lo que quedó en pantalla es la impresora del cliente anterior, y el
 * siguiente que llega tiene que encontrar la pantalla limpia. El cierre de
 * sesión con sus avisos es #41; esto es solo el "volver al principio".
 *
 * Aparte de los componentes para poder probarlo con el reloj parado.
 */
export interface Temporizador {
  /** Vuelve a empezar la cuenta. Se llama en cada toque. */
  reiniciar: () => void;
  parar: () => void;
}

export function crearTemporizador(ms: number, alVencer: () => void): Temporizador {
  let id: ReturnType<typeof setTimeout> | null = null;
  const parar = () => {
    if (id !== null) clearTimeout(id);
    id = null;
  };
  const reiniciar = () => {
    parar();
    id = setTimeout(() => {
      id = null;
      alVencer();
    }, ms);
  };
  reiniciar();
  return { reiniciar, parar };
}

/** Inactividad antes de volver a la atracción. Un minuto: el cliente se fue. */
export const MS_INACTIVIDAD = 60_000;
