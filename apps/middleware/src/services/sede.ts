import { SEDES, sedeDe, type SedeId } from '@asta/shared-types';

/**
 * La sede que pide una pantalla del administrador, validada.
 *
 * Cada sede es una compañía de Odoo (ver `SEDES` en shared-types). Sin `sede`,
 * son todas. Una sede que no existe es un 400 y no «todas»: un enlace mal
 * escrito que enseñara la empresa entera con el nombre de una sede diría una
 * cifra falsa sin que nada lo avisara.
 */
export class SedeInvalida extends Error {
  readonly status = 400;
  readonly code = 'INVALID_QUERY' as const;
  constructor(valor: unknown) {
    super(`Sede desconocida: ${String(valor)}. Las sedes son ${SEDES.map((s) => `${s.id} (${s.nombre})`).join(', ')}.`);
    this.name = 'SedeInvalida';
  }
}

export function sedeDeLaPeticion(query: Record<string, unknown>): SedeId | null {
  const sede = sedeDe(query.sede);
  if (sede === undefined) throw new SedeInvalida(query.sede);
  return sede;
}

/**
 * La condición de dominio de una sede, para `account.move` y `account.move.line`
 * (en la línea, `company_id` es un relacionado almacenado de su factura). Vacía
 * para todas las sedes.
 */
export function enSede(sede: number | null): Array<[string, string, unknown]> {
  return sede === null ? [] : [['company_id', '=', sede]];
}

/** Para claves de cache: `todas` o el id. */
export function claveSede(sede: SedeId | null): string {
  return sede === null ? 'todas' : String(sede);
}
