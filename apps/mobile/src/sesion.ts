/**
 * La sesión de un cliente frente a la tablet (#41).
 *
 * La tablet es un dispositivo COMPARTIDO: lo que quedó en pantalla es de la
 * persona anterior. Cuando haya precios de nivel (#31), dejar una sesión abierta
 * sería enseñarle al siguiente cliente lo que paga el anterior. Por eso la
 * sesión se cierra sola, y al cerrarse no queda nada suyo en pantalla.
 *
 * ── Los dos relojes ──────────────────────────────────────────────────────────
 *
 * Uno avisa y otro cierra. A los 3:30 sin tocar aparece el aviso con «Sigo
 * aquí»; a los 4:00, se cierra. El aviso existe porque cerrarle la sesión a
 * alguien que está leyendo la pantalla —lo normal cuando compara dos tóners— es
 * peor que el riesgo que se evita, y porque un cierre sin aviso parece una
 * avería.
 *
 * Cualquier toque reinicia los dos. «Sigo aquí» es un toque como otro.
 *
 * ── Fuera de los componentes ─────────────────────────────────────────────────
 *
 * Aquí no hay React: así se prueba con el reloj parado, que es la única forma
 * de probar cuatro minutos sin esperarlos.
 */

/** Inactividad antes de cerrar la sesión. Lo fija #41. */
export const MS_SESION = 4 * 60_000;
/** Cuánto antes del cierre aparece el aviso. */
export const MS_AVISO_ANTES = 30_000;

export interface Sesion {
  /** Cada interacción del cliente. Reinicia los dos relojes y quita el aviso. */
  tocar: () => void;
  /** El cliente cierra a mano con «Terminar». */
  terminar: () => void;
  /** Se acabó la sesión desde fuera (cambio de pantalla, app en segundo plano). */
  parar: () => void;
}

export interface Opciones {
  /** Se llama con `true` al aparecer el aviso y con `false` al retirarse. */
  alAvisar: (visible: boolean) => void;
  /** Por qué se cerró: importa para la telemetría y para lo que se le dice al cliente. */
  alCerrar: (motivo: 'timeout' | 'logout') => void;
  msSesion?: number;
  msAvisoAntes?: number;
}

export function crearSesion({ alAvisar, alCerrar, msSesion = MS_SESION, msAvisoAntes = MS_AVISO_ANTES }: Opciones): Sesion {
  let avisar: ReturnType<typeof setTimeout> | null = null;
  let cerrar: ReturnType<typeof setTimeout> | null = null;
  let avisando = false;
  let viva = true;

  const limpiar = () => {
    if (avisar !== null) clearTimeout(avisar);
    if (cerrar !== null) clearTimeout(cerrar);
    avisar = null;
    cerrar = null;
  };

  const ocultarAviso = () => {
    if (!avisando) return;
    avisando = false;
    alAvisar(false);
  };

  const armar = () => {
    limpiar();
    avisar = setTimeout(() => {
      avisando = true;
      alAvisar(true);
    }, Math.max(0, msSesion - msAvisoAntes));
    cerrar = setTimeout(() => {
      viva = false;
      limpiar();
      ocultarAviso();
      alCerrar('timeout');
    }, msSesion);
  };

  const tocar = () => {
    if (!viva) return;
    ocultarAviso();
    armar();
  };

  armar();

  return {
    tocar,
    terminar: () => {
      if (!viva) return;
      viva = false;
      limpiar();
      ocultarAviso();
      alCerrar('logout');
    },
    parar: () => {
      viva = false;
      limpiar();
      ocultarAviso();
    },
  };
}
