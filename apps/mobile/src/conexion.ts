/**
 * Estado de la conexión y reintento en segundo plano (#42).
 *
 * Dos cosas que el issue pide y que en una tienda importan:
 *
 *   · **el personal ve siempre si la tablet está conectada**, sin tener que
 *     buscar una impresora para descubrirlo;
 *   · **al volver la red, la pantalla se pone al día sola**, sin que nadie
 *     tenga que repetir la consulta.
 *
 * ── Cómo se sabe si hay red ──────────────────────────────────────────────────
 *
 * Por lo que pasa con las peticiones de verdad (`reportar`), no por una librería
 * de estado de red: que el wifi de la tienda esté asociado no significa que el
 * middleware conteste, y es eso lo que importa.
 *
 * Mientras está caída, se comprueba cada 15 s con una petición ligera. Cuando
 * vuelve, se avisa una sola vez para que la pantalla recargue lo que tenga.
 */

/**
 * Lo que el personal necesita distinguir:
 *
 *   · `conectado`      todo en vivo;
 *   · `sin_conexion`   la tablet no llega al middleware: wifi o servidor;
 *   · `sin_datos_vivos` el middleware contesta pero el ERP no. La búsqueda de
 *     impresoras sigue funcionando —es de nuestra base—; lo que no se puede
 *     saber es la existencia.
 *
 * La diferencia importa: una se arregla en la tienda (el router) y la otra no.
 */
export type EstadoConexion = 'conectado' | 'sin_conexion' | 'sin_datos_vivos';

/** Lo que reporta cada petición. */
export type Informe = 'ok' | 'sin_red' | 'sin_erp';

export interface Vigilante {
  /** Lo llama la capa de datos con el resultado de cada petición. */
  reportar: (informe: Informe) => void;
  estado: () => EstadoConexion;
  parar: () => void;
}

export interface OpcionesVigilante {
  /** Petición ligera contra el servidor. `true` si contestó. */
  comprobar: () => Promise<boolean>;
  alCambiar: (estado: EstadoConexion) => void;
  /** Al recuperar la red: recargar lo que haya en pantalla. */
  alRecuperar: () => void;
  msReintento?: number;
}

export const MS_REINTENTO = 15_000;

export function crearVigilante({ comprobar, alCambiar, alRecuperar, msReintento = MS_REINTENTO }: OpcionesVigilante): Vigilante {
  let estado: EstadoConexion = 'conectado';
  let timer: ReturnType<typeof setInterval> | null = null;
  let vivo = true;

  const pararSondeo = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const pasarA = (nuevo: EstadoConexion) => {
    if (estado === nuevo) return;
    const volvio = estado !== 'conectado' && nuevo === 'conectado';
    estado = nuevo;
    alCambiar(nuevo);
    if (nuevo !== 'conectado') {
      // Sondeo solo mientras algo está caído: preguntar cada 15 s con todo bien
      // es gastar batería y llenar la bitácora del servidor. Con el ERP caído
      // también se sondea: `/health` comprueba Odoo y MySQL.
      pararSondeo();
      timer = setInterval(() => {
        void comprobar().then((ok) => {
          if (vivo && ok) pasarA('conectado');
        });
      }, msReintento);
    } else {
      pararSondeo();
      if (volvio) alRecuperar();
    }
  };

  return {
    reportar: (informe) => {
      if (!vivo) return;
      pasarA(informe === 'ok' ? 'conectado' : informe === 'sin_red' ? 'sin_conexion' : 'sin_datos_vivos');
    },
    estado: () => estado,
    parar: () => {
      vivo = false;
      pararSondeo();
    },
  };
}
