/**
 * Formato de números y fechas.
 *
 * Los importes vienen de `amount_total_signed` de Odoo, en moneda de la
 * compañía (USD en esta instancia). No se convierte nada: mostrar una
 * conversión que el ERP no hizo sería inventar un dato.
 *
 * ── Cómo se escribe un importe ───────────────────────────────────────────────
 *
 * Siempre con su símbolo y como se escribe en Venezuela: «$1.234,56», punto
 * para los miles y coma para los decimales. Negativo, con el signo menos de
 * verdad delante del símbolo: «−$1.234,56». Tres formas, según dónde va:
 *
 *   · `money`        — con céntimos: el detalle de una factura, un saldo.
 *   · `moneyEntero`  — sin céntimos: columnas de tablas, para comparar de un
 *                      vistazo; el exacto, en el `title`.
 *   · `moneyCompact` — abreviado en las tarjetas de resumen: «$53,1 mil»,
 *                      «$1,2 M». Por debajo de 10.000, con céntimos.
 *
 * Ningún sitio escribe «USD» ni «$» a mano: si hace falta otra forma, va aquí.
 */

const dinero = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 });
const unDecimal = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 });

/** «$» delante y el signo menos tipográfico (U+2212) si es negativo. */
function conSimbolo(n: number, cifra: (x: number) => string): string {
  const texto = cifra(Math.abs(n));
  // −0,004 se redondea a «0,00»: sin signo, que «−$0,00» no significa nada.
  return n < 0 && /[1-9]/.test(texto) ? `\u2212$${texto}` : `$${texto}`;
}

export function money(n: number): string {
  return conSimbolo(n, (x) => dinero.format(x));
}

/**
 * Para las columnas de una tabla: sin decimales y siempre igual.
 *
 * `moneyCompact` en una columna mezcla «$28,3 mil» con «$8.109,80» según la
 * fila, y así no se comparan de un vistazo. Aquí «$28.312» y «$8.110»:
 * alineadas a la derecha, el número más largo es el mayor. El exacto, en el
 * `title`.
 */
export function moneyEntero(n: number): string {
  return conSimbolo(n, (x) => entero.format(x));
}

/**
 * Para las tarjetas de resumen, donde el total exacto no aporta: «$53,1 mil»,
 * «$1,2 M». En palabras y no con «k»: es un panel en español. Se escribe a mano
 * porque el abreviado de `Intl` para es-VE da «53,1 k».
 */
export function moneyCompact(n: number): string {
  const x = Math.abs(n);
  if (x >= 999_950) return conSimbolo(n, (v) => `${unDecimal.format(v / 1_000_000)} M`);
  if (x >= 10_000) return conSimbolo(n, (v) => `${unDecimal.format(v / 1_000)} mil`);
  return money(n);
}

export function fecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Zona horaria en la que se muestran las fechas con hora.
 *
 * ── Por qué se fija en vez de usar la del navegador ──────────────────────────
 *
 * Los componentes de cliente TAMBIÉN se renderizan en el servidor. Si el formato
 * depende de la zona horaria de quien renderiza, el servidor (en producción, un
 * contenedor en UTC) y el navegador (en Caracas) producen textos distintos para
 * la misma fecha, y React aborta la hidratación con "server rendered text
 * didn't match".
 *
 * En desarrollo no se ve, porque el servidor de Next y el navegador son la misma
 * máquina y comparten zona. Aparecería en el primer despliegue.
 *
 * Fijarla resuelve las dos cosas a la vez: el texto es el mismo en los dos
 * lados, y es la hora de la tienda, que es la que le sirve al vendedor.
 */
export const ZONA = 'America/Caracas';

/** Fecha con hora, estable entre servidor y navegador. */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleString('es-VE', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Solo el día, estable entre servidor y navegador. */
export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleDateString('es-VE', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
