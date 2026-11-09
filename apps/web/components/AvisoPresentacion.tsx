'use client';

import { cambiarPresentacion } from '@/lib/presentacion';

/**
 * Que se vea que el modo presentación está encendido, y que se apague de un
 * toque: sin esto, el que lo encendió para una reunión se encuentra días
 * después un panel con las cifras difuminadas y no sabe por qué.
 */
export function AvisoPresentacion() {
  return (
    <button type="button" className="aviso-presentacion" onClick={() => cambiarPresentacion(false)} title="Volver a ver las cifras">
      <span aria-hidden="true">◐</span> Presentación · <b>quitar</b>
    </button>
  );
}
