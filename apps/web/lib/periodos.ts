import type { SedeId } from '@asta/shared-types';

/**
 * Los atajos de periodo y la URL de los filtros (`components/Periodos.tsx`,
 * `components/Sedes.tsx`). Aparte para que los usen también los desplegables,
 * que corren en el navegador.
 */

/** La URL de una pantalla con su periodo (si lo tiene) y su sede (si no es «todas»). */
export function urlCon(base: string, { periodo, sede }: { periodo?: { desde: string; hasta: string }; sede: SedeId | null }): string {
  const qs = new URLSearchParams();
  if (periodo) {
    qs.set('desde', periodo.desde);
    qs.set('hasta', periodo.hasta);
  }
  if (sede !== null) qs.set('sede', String(sede));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export const PRESETS = [
  { clave: '12m', etiqueta: 'Últimos 12 meses' },
  { clave: 'anio', etiqueta: 'Este año' },
  { clave: 'trimestre', etiqueta: 'Últimos 3 meses' },
  { clave: 'anterior', etiqueta: 'Año pasado' },
] as const;

export type Preset = (typeof PRESETS)[number]['clave'];

export function fechasDe(preset: Preset, hoy = new Date()): { desde: string; hasta: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hasta = iso(hoy);

  if (preset === 'anio') return { desde: `${hoy.getUTCFullYear()}-01-01`, hasta };
  if (preset === 'anterior') {
    const y = hoy.getUTCFullYear() - 1;
    return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
  }

  const d = new Date(hoy);
  d.setUTCMonth(d.getUTCMonth() - (preset === 'trimestre' ? 2 : 11));
  d.setUTCDate(1);
  return { desde: iso(d), hasta };
}
