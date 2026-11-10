import type { ClaveCategoria } from './categoriasAsta.js';
import { ESCALERA, NIVEL_MAXIMO, nivelBloqueado } from './programaAsta.js';

/**
 * Lo que gana el cliente en cada nivel del programa ASTA (aprobado por
 * Supricom el 2026-11-10). Cada nivel conserva los de los de abajo; un
 * beneficio con la misma `clave` sustituye al de abajo (el crédito de 7 días
 * pasa a 15 en Plata, no se suman).
 *
 * Cliente general no tiene beneficios: son el premio por llegar a Bronce.
 * Diamante está bloqueado (`NIVEL_MAXIMO`) y sus beneficios, sin aprobar: no
 * hay ninguno escrito aquí, y se enseña con candado.
 *
 * Son los mismos para todos los clientes del nivel: no son un dato de nadie.
 */

export interface Beneficio {
  /** Lo que identifica al beneficio entre niveles: el de arriba sustituye al de abajo. */
  clave: string;
  titulo: string;
  detalle: string;
}

const POR_NIVEL: Partial<Record<ClaveCategoria, readonly Beneficio[]>> = {
  BRONCE: [
    { clave: 'credito', titulo: 'Crédito a 7 días', detalle: 'Las compras de ASTA, a pagar en 7 días.' },
    { clave: 'kit', titulo: 'Kit de bienvenida', detalle: 'Acceso al banco de flyers y material P.O.P. para la tienda.' },
    {
      clave: 'aplicacion',
      titulo: 'Aplicación ASTA y panel',
      detalle: 'La aplicación para encontrar el ASTA de cada impresora, y el panel con métricas, sell-out, compras y nivel.',
    },
  ],
  PLATA: [
    { clave: 'credito', titulo: 'Crédito a 15 días', detalle: 'Las compras de ASTA, a pagar en 15 días.' },
    { clave: 'destacado', titulo: 'Cliente destacado en la web', detalle: 'En la web de ASTA y en «Dónde comprar», para recibir compradores de la zona.' },
    { clave: 'flash', titulo: 'Promociones flash', detalle: 'Ofertas de oportunidad cada mes.' },
  ],
  ORO: [
    { clave: 'credito', titulo: 'Crédito a 30 días', detalle: 'Las compras de ASTA, a pagar en 30 días.' },
    { clave: 'envio', titulo: 'Envío gratis', detalle: 'Los pedidos de ASTA, sin costo de envío.' },
    { clave: 'exhibidor', titulo: 'Exhibidor + tablet', detalle: 'Un exhibidor ASTA y una tablet con la aplicación en el mostrador.' },
    { clave: 'fondo', titulo: 'Fondo del 2 %', detalle: 'El 2 % de lo comprado en el trimestre, para usar en la siguiente compra.' },
    { clave: 'eventos', titulo: 'Eventos patrocinados', detalle: 'Promotores y actividades en la tienda, patrocinados por ASTA.' },
  ],
};

/** Los que estrena un nivel: los que no tenía en el de abajo, o los que mejora. */
export function beneficiosNuevos(nivel: ClaveCategoria): readonly Beneficio[] {
  return nivelBloqueado(nivel) ? [] : (POR_NIVEL[nivel] ?? []);
}

/** Todos los que tiene un nivel: los suyos y los de abajo, el de arriba en lugar del de abajo. */
export function beneficiosDe(nivel: ClaveCategoria): Beneficio[] {
  const hasta = Math.min(ESCALERA.indexOf(nivel), ESCALERA.indexOf(NIVEL_MAXIMO));
  const todos: Beneficio[] = [];
  for (const n of ESCALERA.slice(0, hasta + 1)) {
    for (const b of POR_NIVEL[n] ?? []) {
      const i = todos.findIndex((x) => x.clave === b.clave);
      if (i >= 0) todos[i] = b;
      else todos.push(b);
    }
  }
  return todos;
}
