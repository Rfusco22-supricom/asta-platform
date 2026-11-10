import { sedeDe, type SedeId } from '@asta/shared-types';
import { ElegirSede } from './ElegirSede';

/**
 * El selector de sede de las pantallas del administrador: todas, o una
 * compañía de Odoo (las mismas que el selector del panel de SUPRICOM).
 *
 * Como `Periodos`, la sede va en la URL (`?sede=9`), así que un
 * enlace guardado o enviado enseña la misma sede. Cada selector conserva lo que
 * eligió el otro: cambiar de sede no te devuelve a los últimos 12 meses.
 */

type Periodo = { desde: string; hasta: string };

export { urlCon } from '@/lib/periodos';

/**
 * La sede de los `searchParams` de una página. Una que no existe se trata como
 * «todas»: el middleware la rechazaría con un 400 y la pantalla no diría por qué.
 */
export function sedeDeParams(params: Record<string, string | string[] | undefined>): SedeId | null {
  return sedeDe(typeof params.sede === 'string' ? params.sede : undefined) ?? null;
}

/** Va en la misma fila que el de periodo (`Periodos`): los dos son un desplegable. */
export function Sedes({ base, sede, periodo }: { base: string; sede: SedeId | null; periodo?: Periodo }) {
  return (
    <div className="filtro-compacto">
      <ElegirSede base={base} sede={sede} periodo={periodo} />
    </div>
  );
}
