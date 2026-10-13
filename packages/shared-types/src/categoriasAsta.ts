import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * Las categorías de cliente de ASTA (propuesta de Marketing del 2026-10-13, #131).
 *
 * Calibradas para pasar de unos 53.000 a 100.000 USD/mes de ASTA. La compra
 * mensual es el promedio de ASTA del cliente en los últimos cuatro meses
 * COMPLETOS, con los clientes agrupados por RIF; y además hay que haber comprado
 * en un mínimo de esos meses (la «regla de fidelidad»), para que un pedido
 * grande y suelto no haga Diamante a nadie.
 *
 * Un cliente queda en la categoría MÁS ALTA cuyas dos condiciones cumple: quien
 * compra 2.000 al mes pero solo en dos de los cuatro meses no es Oro, y sí
 * Bronce. Las reglas viven solo aquí: cambiarlas es cambiar esta lista.
 */

export const claveCategoriaSchema = z.enum(['DIAMANTE', 'ORO', 'PLATA', 'BRONCE', 'GENERAL']);
export type ClaveCategoria = z.infer<typeof claveCategoriaSchema>;

export interface ReglaCategoria {
  clave: ClaveCategoria;
  nombre: string;
  /** Compra mensual mínima, en USD sin IVA. */
  minimoMensual: number;
  /** Meses con compra, de los cuatro de la ventana. */
  minimoMeses: number;
  /** Cuántos clientes quiere Marketing en esta categoría para llegar a la meta. `null`: el resto. */
  metaClientes: number | null;
  /** Compra mensual que aporta la categoría en el escenario de la meta. */
  metaCompraMensual: number;
}

/** De más alta a más baja: el orden en que se prueban. */
export const CATEGORIAS_ASTA: readonly ReglaCategoria[] = [
  { clave: 'DIAMANTE', nombre: 'Diamante', minimoMensual: 3000, minimoMeses: 3, metaClientes: 6, metaCompraMensual: 21600 },
  { clave: 'ORO', nombre: 'Oro', minimoMensual: 1500, minimoMeses: 3, metaClientes: 12, metaCompraMensual: 24000 },
  { clave: 'PLATA', nombre: 'Plata', minimoMensual: 600, minimoMeses: 3, metaClientes: 24, metaCompraMensual: 22800 },
  { clave: 'BRONCE', nombre: 'Bronce', minimoMensual: 250, minimoMeses: 2, metaClientes: 45, metaCompraMensual: 18000 },
  { clave: 'GENERAL', nombre: 'Cliente general', minimoMensual: 0, minimoMeses: 0, metaClientes: null, metaCompraMensual: 13600 },
];

/** La meta de ASTA, en USD sin IVA al mes. */
export const META_MENSUAL_ASTA = 100_000;

/** Meses completos que se promedian. */
export const MESES_VENTANA_CATEGORIA = 4;

/** La categoría de una compra mensual y unos meses con compra. */
export function categoriaDe(compraMensual: number, mesesConCompra: number): ReglaCategoria {
  return CATEGORIAS_ASTA.find((c) => compraMensual >= c.minimoMensual && mesesConCompra >= c.minimoMeses) ?? CATEGORIAS_ASTA.at(-1)!;
}

export function reglaDe(clave: ClaveCategoria): ReglaCategoria {
  return CATEGORIAS_ASTA.find((c) => c.clave === clave)!;
}

export const clienteCategoriaSchema = z.object({
  /** RIF normalizado, o «p<id>» si el cliente no tiene RIF: la agrupación. */
  clave: z.string(),
  /** La ficha principal del grupo, para enlazar a ella. */
  partnerId: odooIdSchema,
  nombre: z.string(),
  rif: z.string().nullable(),
  vendedor: z.string().nullable(),
  vendedorOdooUserId: odooIdSchema.nullable(),
  /** Compra de cada mes de la ventana, del más antiguo al más reciente. */
  porMes: z.array(montoSchema),
  compraMensual: montoSchema,
  mesesConCompra: z.number().int().min(0).max(12),
  categoria: claveCategoriaSchema,
  /** Lo que le falta para la categoría siguiente; `null` en Diamante. */
  siguiente: z
    .object({
      categoria: claveCategoriaSchema,
      faltaMensual: montoSchema,
      faltanMeses: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ClienteCategoria = z.infer<typeof clienteCategoriaSchema>;

export const categoriasAstaSchema = z.object({
  /** Los meses de la ventana, «YYYY-MM», del más antiguo al más reciente. */
  meses: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
  compraMensual: montoSchema,
  meta: montoSchema,
  porCategoria: z.array(
    z.object({
      categoria: claveCategoriaSchema,
      clientes: z.number().int().nonnegative(),
      compraMensual: montoSchema,
      metaClientes: z.number().int().nonnegative().nullable(),
      metaCompraMensual: montoSchema,
    }),
  ),
  /** De más compra mensual a menos. Solo los que compraron algo en la ventana. */
  clientes: z.array(clienteCategoriaSchema),
});
export type CategoriasAsta = z.infer<typeof categoriasAstaSchema>;

export const categoriasAstaRespuestaSchema = z.object({
  data: categoriasAstaSchema,
  meta: z.object({ generadoEn: z.iso.datetime(), duracionMs: z.number().int().nonnegative() }),
});
