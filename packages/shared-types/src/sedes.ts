/**
 * Las sedes por las que se pueden mirar las estadísticas del administrador.
 *
 * Cada sede es una compañía de Odoo, con los mismos ids que el selector de sede
 * del panel de SUPRICOM (Metas por marca, `lib/metas-marca/odoo.ts` del repo
 * Dashboard). Así, «Valencia» en un panel y en el otro suma lo mismo.
 *
 * En la URL va el id (`?sede=9`), igual que allí `?company_id=9`. Sin `sede`,
 * son todas las de Venezuela.
 *
 * Panamá (compañía 7) no vende ASTA (decidido el 2026-10-28): no sale en el
 * selector y «Todas las sedes» la deja fuera, porque sus ventas de otras
 * marcas hacían parecer menor la cuota de ASTA. Sus almacenes, Central y Colón,
 * son de esa compañía.
 */
export const SEDES = [
  { id: 9, nombre: 'Valencia' },
  { id: 10, nombre: 'Caracas' },
] as const;

/** Las compañías de Odoo que no cuentan en ninguna estadística: Panamá. */
export const COMPANIAS_FUERA = [7] as const;

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

/** ¿Cuenta una venta de esta compañía en «Todas las sedes»? */
export function companiaCuenta(companyId: number | null | undefined): boolean {
  return !(COMPANIAS_FUERA as readonly number[]).includes(companyId ?? -1);
}
