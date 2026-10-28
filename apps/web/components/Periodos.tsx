import Link from 'next/link';
import type { SedeId } from '@asta/shared-types';
import { nombrePeriodo } from '@/lib/meses';
import { CargandoEnlace } from './CargandoEnlace';
import { ElegirPeriodo } from './ElegirPeriodo';
import { urlCon } from './Sedes';

/**
 * El selector de periodo, compartido por los Inicios, los reportes y el
 * recomendador: cuatro atajos, un mes o un año concretos (`ElegirPeriodo`), y
 * debajo el periodo que se está viendo, con palabras, para que ninguna cifra
 * de la pantalla quede sin su «en cuánto tiempo».
 *
 * Los botones llevan las FECHAS en la URL, no un `?preset=anio`: así un enlace
 * guardado o pasado a otra persona enseña lo mismo que enseñaba. Un `preset`
 * guardado en marzo diría otra cosa en diciembre.
 */

const PRESETS = [
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

/** Con `sede`, los enlaces la conservan (ver `Sedes`). */
export function Periodos({
  base,
  periodo,
  sede = null,
}: {
  base: string;
  periodo: { desde: string; hasta: string };
  sede?: SedeId | null;
}) {
  return (
    <div className="periodos-bloque">
    <div className="periodos">
      {PRESETS.map((p) => {
        const { desde, hasta } = fechasDe(p.clave);
        const activo = periodo.desde === desde && periodo.hasta === hasta;
        return (
          <Link key={p.clave} href={urlCon(base, { periodo: { desde, hasta }, sede })} className={`periodo${activo ? ' periodo--activo' : ''}`}>
            {p.etiqueta}
            <CargandoEnlace />
          </Link>
        );
      })}
      <ElegirPeriodo base={base} periodo={periodo} sede={sede} />
    </div>
    <p className="periodos-texto">
      Cifras de <strong>{nombrePeriodo(periodo.desde, periodo.hasta)}</strong>
    </p>
    </div>
  );
}
