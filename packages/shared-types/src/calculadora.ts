import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * La calculadora de ganancia: cuánto gana el cliente vendiendo el ASTA en lugar
 * del original, y cuánto ahorra quien le compra a él.
 *
 * Cada pareja es un ASTA y el original al que sustituye (el mismo emparejado
 * que «Impulsa»: `equivalentesAsta`), con los precios de SU tarifa. Solo salen
 * las parejas con los dos precios: nunca se enseña un precio que no es el suyo.
 *
 * La cuenta la hace la pantalla, con el margen que él gana en el original y el
 * descuento que le daría a su cliente con ASTA:
 *
 *   venta del original = coste del original × (1 + margen)
 *   venta del ASTA     = venta del original × (1 − descuento)
 *   ganancia           = venta − coste, en cada uno
 */

export const MARGEN_POR_DEFECTO = 0.3;
export const DESCUENTO_POR_DEFECTO = 0.3;

const productoCalculadoraSchema = z.object({
  productId: odooIdSchema,
  sku: z.string(),
  nombre: z.string(),
  /** Precio de su tarifa, sin IVA. */
  precio: montoSchema,
});

export const parejaCalculadoraSchema = z.object({
  asta: productoCalculadoraSchema,
  original: productoCalculadoraSchema.extend({ marca: z.string().nullable() }),
  /** Lo que nos compra al mes de cada uno (media de los 3 últimos meses completos). */
  compraMensualOriginal: z.number().nonnegative(),
  compraMensualAsta: z.number().nonnegative(),
});
export type ParejaCalculadora = z.infer<typeof parejaCalculadoraSchema>;

export const calculadoraSchema = z.object({
  /** Primero las que compra en original (donde más puede ganar cambiando), luego por diferencia de precio. */
  parejas: z.array(parejaCalculadoraSchema),
});
export type Calculadora = z.infer<typeof calculadoraSchema>;
export const calculadoraRespuestaSchema = z.object({ data: calculadoraSchema });

/** La cuenta de una pareja. Pura: la usan la pantalla y los tests. */
export function calcularGanancia(p: Pick<ParejaCalculadora, 'asta' | 'original'>, margen: number, descuento: number) {
  const ventaOriginal = p.original.precio * (1 + margen);
  const ventaAsta = ventaOriginal * (1 - descuento);
  const gananciaOriginal = ventaOriginal - p.original.precio;
  const gananciaAsta = ventaAsta - p.asta.precio;
  return {
    ventaOriginal,
    ventaAsta,
    gananciaOriginal,
    gananciaAsta,
    /** Lo que gana de más (o de menos) por unidad vendiendo el ASTA. */
    gananciaExtra: gananciaAsta - gananciaOriginal,
    /** Lo que ahorra quien le compra. */
    ahorroCliente: ventaOriginal - ventaAsta,
  };
}
