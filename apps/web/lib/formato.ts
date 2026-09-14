/**
 * Formato de números y fechas.
 *
 * Los importes vienen de `amount_total_signed` de Odoo, en moneda de la
 * compañía (USD en esta instancia). No se convierte nada: mostrar una
 * conversión que el ERP no hizo sería inventar un dato.
 */

const dinero = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compacto = new Intl.NumberFormat('es-VE', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function money(n: number): string {
  return dinero.format(n);
}

/** Para las tarjetas de resumen, donde el total exacto no aporta. */
export function moneyCompact(n: number): string {
  return Math.abs(n) >= 10_000 ? compacto.format(n) : dinero.format(n);
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
