/**
 * El rango que pide una pantalla de reportes, validado.
 *
 * Vive aparte de las dos rutas porque las dos lo necesitan igual y la única
 * forma de que no discrepen es que sea el mismo código. Si la del vendedor
 * aceptara un rango que la del administrador rechaza, el número que ve cada uno
 * dejaría de ser comparable.
 */
export interface RangoPedido {
  desde: string;
  hasta: string;
}

/**
 * Sin `status`, `errorHandler` no lo reconocía como error tipado y lo servía
 * como un 500 "error no controlado": `/admin/reportes?desde=2026-02-31`
 * respondía error interno en vez de explicar la fecha. Visto al reutilizarlo en
 * las estadísticas del recomendador (#43).
 */
export class RangoInvalido extends Error {
  readonly status = 400;
  readonly code = 'INVALID_DATE_RANGE' as const;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'RangoInvalido';
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Que la fecha exista de verdad, no solo que tenga la forma.
 *
 * `Date.parse('2026-02-31')` NO devuelve NaN: JavaScript la hace rodar al 3 de
 * marzo sin decir nada. Así que un `?desde=2026-02-31` habría pasado la
 * validación y el reporte habría sumado desde otro día del que dice su propio
 * encabezado — el tipo de error que nadie descubre porque el número sale.
 *
 * La comprobación es de ida y vuelta: se construye la fecha y se mira si vuelve
 * a escribirse igual.
 */
function existeEnElCalendario(iso: string): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === iso;
}

/** Los últimos doce meses cerrados hasta hoy. Es el rango por defecto. */
export function ultimosDoceMeses(hoy = new Date()): RangoPedido {
  const hasta = hoy.toISOString().slice(0, 10);
  const d = new Date(hoy);
  d.setUTCMonth(d.getUTCMonth() - 11);
  d.setUTCDate(1);
  return { desde: d.toISOString().slice(0, 10), hasta };
}

/**
 * Lee `?desde=&hasta=` y devuelve un rango utilizable.
 *
 * Sin parámetros, los últimos doce meses. Con uno solo, falla en vez de
 * inventarse el otro: un reporte que dice «desde enero» y calcula otra cosa es
 * peor que uno que no sale.
 */
export function rangoDeLaPeticion(
  query: Record<string, unknown>,
  hoy = new Date(),
): RangoPedido {
  const desde = query.desde;
  const hasta = query.hasta;

  if (desde === undefined && hasta === undefined) return ultimosDoceMeses(hoy);

  if (typeof desde !== 'string' || typeof hasta !== 'string') {
    throw new RangoInvalido('Hay que dar las dos fechas, `desde` y `hasta`, o ninguna.');
  }
  if (!ISO.test(desde) || !ISO.test(hasta)) {
    throw new RangoInvalido('Las fechas van en formato YYYY-MM-DD.');
  }
  if (!existeEnElCalendario(desde) || !existeEnElCalendario(hasta)) {
    throw new RangoInvalido('Alguna de las dos fechas no existe en el calendario.');
  }
  if (desde > hasta) {
    throw new RangoInvalido('`desde` es posterior a `hasta`.');
  }

  /*
   * Tope de cinco años.
   *
   * No es una manía: cada mes del rango es una fila de la serie y una barra en
   * la pantalla, y el `read_group` de Odoo sobre un rango enorme es de los que
   * se van al timeout de 30 s. Se corta aquí, con un mensaje, en vez de dejar
   * que muera a mitad.
   */
  const meses =
    (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 +
    (Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7)));
  if (meses > 60) {
    throw new RangoInvalido('El rango no puede pasar de cinco años.');
  }

  return { desde, hasta };
}
