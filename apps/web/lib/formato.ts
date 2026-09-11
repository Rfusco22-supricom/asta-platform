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
