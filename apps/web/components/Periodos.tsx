import type { SedeId } from '@asta/shared-types';
import { nombrePeriodo } from '@/lib/meses';
import { ElegirPeriodo } from './ElegirPeriodo';

export { fechasDe, type Preset } from '@/lib/periodos';

/**
 * El filtro de periodo, compartido por los Inicios, los reportes y las demás
 * pantallas con fechas: UN desplegable con los atajos (últimos 12 meses, este
 * año…), un mes o un año concretos (`ElegirPeriodo`), y al lado el periodo que
 * se está viendo, con palabras, para que ninguna cifra quede sin su «en cuánto
 * tiempo». Va en la misma fila que el de sede (`Sedes`).
 *
 * Lleva las FECHAS en la URL, no un `?preset=anio`: así un enlace guardado o
 * pasado a otra persona enseña lo mismo que enseñaba. Un `preset` guardado en
 * marzo diría otra cosa en diciembre.
 */
export function Periodos({
  base,
  periodo,
  sede = null,
}: {
  base: string;
  periodo: { desde: string; hasta: string };
  /** Con sede, el cambio de periodo la conserva (ver `Sedes`). */
  sede?: SedeId | null;
}) {
  return (
    <div className="filtro-compacto">
      <ElegirPeriodo base={base} periodo={periodo} sede={sede} />
      <span className="periodos-texto">
        Cifras de <strong>{nombrePeriodo(periodo.desde, periodo.hasta)}</strong>
      </span>
    </div>
  );
}
