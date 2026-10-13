import Link from 'next/link';
import { SEDES, sedeDe, type SedeId } from '@asta/shared-types';
import { CargandoEnlace } from './CargandoEnlace';

/**
 * El selector de sede de las pantallas del administrador: todas, o una
 * compañía de Odoo (las mismas que el selector del panel de SUPRICOM).
 *
 * Como `Periodos`, son enlaces y la sede va en la URL (`?sede=9`), así que un
 * enlace guardado o enviado enseña la misma sede. Cada selector conserva lo que
 * eligió el otro: cambiar de sede no te devuelve a los últimos 12 meses.
 */

type Periodo = { desde: string; hasta: string };

/** La URL de una pantalla con su periodo (si lo tiene) y su sede (si no es «todas»). */
export function urlCon(base: string, { periodo, sede }: { periodo?: Periodo; sede: SedeId | null }): string {
  const qs = new URLSearchParams();
  if (periodo) {
    qs.set('desde', periodo.desde);
    qs.set('hasta', periodo.hasta);
  }
  if (sede !== null) qs.set('sede', String(sede));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * La sede de los `searchParams` de una página. Una que no existe se trata como
 * «todas»: el middleware la rechazaría con un 400 y la pantalla no diría por qué.
 */
export function sedeDeParams(params: Record<string, string | string[] | undefined>): SedeId | null {
  return sedeDe(typeof params.sede === 'string' ? params.sede : undefined) ?? null;
}

export function Sedes({ base, sede, periodo }: { base: string; sede: SedeId | null; periodo?: Periodo }) {
  const opciones: Array<{ id: SedeId | null; nombre: string }> = [{ id: null, nombre: 'Todas las sedes' }, ...SEDES];
  return (
    <nav className="periodos sedes" aria-label="Sede">
      {opciones.map((o) => (
        <Link
          key={o.id ?? 'todas'}
          href={urlCon(base, { periodo, sede: o.id })}
          className={`periodo${sede === o.id ? ' periodo--activo' : ''}`}
          aria-current={sede === o.id ? 'page' : undefined}
        >
          {o.nombre}
          <CargandoEnlace />
        </Link>
      ))}
    </nav>
  );
}
