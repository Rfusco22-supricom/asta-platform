/**
 * Las sedes por las que se pueden mirar las estadísticas del administrador.
 *
 * Cada sede es una compañía de Odoo, con los mismos ids que el selector de sede
 * del panel de SUPRICOM (Metas por marca, `lib/metas-marca/odoo.ts` del repo
 * Dashboard). Así, «Valencia» en un panel y en el otro suma lo mismo.
 *
 * En la URL va el id (`?sede=9`), igual que allí `?company_id=9`. Sin `sede`,
 * son todas.
 */
export const SEDES = [
  { id: 9, nombre: 'Valencia' },
  { id: 10, nombre: 'Caracas' },
  { id: 7, nombre: 'Panamá' },
] as const;

export type SedeId = (typeof SEDES)[number]['id'];

/**
 * La sede de un parámetro de la URL: `null` si no viene (todas) y `undefined`
 * si viene y no es una sede, para que quien llama decida si eso es un error.
 */
export function sedeDe(valor: unknown): SedeId | null | undefined {
  if (valor === undefined || valor === null || valor === '' || valor === 'todas') return null;
  const id = Number(valor);
  return SEDES.find((s) => s.id === id)?.id;
}

export function nombreSede(id: SedeId | null): string {
  return id === null ? 'Todas las sedes' : (SEDES.find((s) => s.id === id)?.nombre ?? `Sede ${id}`);
}
