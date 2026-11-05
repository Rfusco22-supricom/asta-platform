import { z } from 'zod';

/**
 * «Tú frente a tu zona»: cómo compra ASTA un cliente comparado con los demás
 * clientes de su estado y de todo el país, en los últimos doce meses.
 *
 * Es ANÓNIMA: nunca sale el nombre ni la cifra de otro cliente, solo su
 * posición y cifras de grupo (el cliente típico, lo que hace falta para estar
 * entre los que más compran). Por eso un estado con menos de
 * `MIN_CLIENTES_ZONA` clientes no se enseña: con tres, «el cliente típico» es
 * casi decir quién es. Entonces se le compara solo con el país.
 *
 * Cuentan los clientes que compraron ASTA en el periodo (neto de devoluciones,
 * sin intercompañía ni Panamá), con Odoo y la historia de Smartbit. La zona es
 * el estado de su ficha en Odoo.
 */

/** Clientes que tiene que tener un estado para compararse con él. */
export const MIN_CLIENTES_ZONA = 5;

/** «Los que más compran»: el cuarto de arriba. */
export const PARTE_ALTA_ZONA = 0.25;

/** Una medida: lo suyo frente al grupo. */
export const medidaZonaSchema = z.object({
  tuyo: z.number().nonnegative(),
  /** El cliente típico: la mitad del grupo está por encima y la mitad por debajo. */
  tipico: z.number().nonnegative(),
  /** Desde cuánto se está en el `PARTE_ALTA_ZONA` que más tiene. */
  parteAlta: z.number().nonnegative(),
});
export type MedidaZona = z.infer<typeof medidaZonaSchema>;

export const grupoZonaSchema = z.object({
  ambito: z.enum(['ZONA', 'PAIS']),
  /** «Carabobo», o «todo el país». */
  nombre: z.string(),
  /** Cuántos clientes compraron ASTA en el grupo. */
  clientes: z.number().int().positive(),
  /** Su puesto por compras (1 = el que más). `null` si no compró ASTA en el periodo. */
  puesto: z.number().int().positive().nullable(),
  /** Compras de ASTA en el periodo, sin IVA. */
  compras: medidaZonaSchema,
  /** Productos ASTA distintos que compró. */
  referencias: medidaZonaSchema,
  /** Meses del periodo en los que compró ASTA. */
  meses: medidaZonaSchema,
});
export type GrupoZona = z.infer<typeof grupoZonaSchema>;

export const comparativaZonaSchema = z.object({
  periodo: z.object({ desde: z.iso.date(), hasta: z.iso.date() }),
  /** El estado de su ficha, aunque tenga pocos clientes. `null` si no tiene. */
  estado: z.string().nullable(),
  /** Su estado. `null` si no tiene, o si tiene menos de `MIN_CLIENTES_ZONA` clientes. */
  zona: grupoZonaSchema.nullable(),
  /** Todo el país. `null` solo si nadie ha comprado ASTA en el periodo. */
  pais: grupoZonaSchema.nullable(),
});
export type ComparativaZona = z.infer<typeof comparativaZonaSchema>;
export const comparativaZonaRespuestaSchema = z.object({ data: comparativaZonaSchema });

/** Del puesto, el «X %» que más compra que se le dice: siempre redondeado hacia arriba. */
export function porcentajeArriba(puesto: number, clientes: number): number {
  return Math.min(100, Math.max(1, Math.ceil((puesto / clientes) * 100)));
}
