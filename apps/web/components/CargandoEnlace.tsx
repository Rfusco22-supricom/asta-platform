'use client';

import { useLinkStatus } from 'next/link';

/**
 * El aviso de «abriendo…» de un enlace. Va DENTRO de un `<Link>`.
 *
 * Cada pantalla se pinta en el servidor después de leer Odoo, y eso tarda: sin
 * aviso, el clic no hace nada visible durante uno o dos segundos y la gente
 * vuelve a pulsar. `useLinkStatus` dice si la navegación de ESTE enlace está en
 * marcha; mientras lo está, se pinta un indicador.
 *
 * Lo demás —la barra de arriba, el contenido atenuado— lo hace el CSS con
 * `body:has(.enlace-cargando)` (ver `globals.css`): no hace falta un estado
 * compartido entre el menú y la pantalla, y el aviso desaparece solo cuando la
 * página nueva sustituye a la anterior.
 */
export function CargandoEnlace() {
  const { pending } = useLinkStatus();
  return pending ? <span className="enlace-cargando" role="status" aria-label="Cargando" /> : null;
}
