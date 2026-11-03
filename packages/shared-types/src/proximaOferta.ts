import { z } from 'zod';
import { odooIdSchema } from './common.js';

/**
 * La próxima mejor oferta para un cliente: los productos ASTA que compran sus
 * clientes parecidos y él no ha comprado nunca (en `MESES_OFERTA` meses).
 *
 * «Parecido» es quien compra los mismos productos ASTA que él: cuantos más
 * comparten, más parecido (coseno sobre lo que compra cada uno, sin cantidades).
 * Se miran los `VECINOS_OFERTA` más parecidos, y cada producto que él no compra
 * suma lo parecido que es cada uno que sí lo compra.
 *
 * Si no ha comprado nunca ASTA no hay con quién compararlo: se le ofrecen los
 * más vendidos (`MAS_VENDIDOS`).
 *
 * Es distinto de «Impulsa a tus clientes»: allí se cambia a ASTA lo que ya
 * compra de otra marca; aquí se le ofrece lo que todavía no compra.
 */

/** Meses de compras con los que se compara. */
export const MESES_OFERTA = 12;

/** Clientes parecidos con los que se compara a cada uno. */
export const VECINOS_OFERTA = 25;

/** Productos que se ofrecen como mucho. */
export const PRODUCTOS_OFERTA = 5;

export const productoOfertaSchema = z.object({
  productId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  /** De sus clientes parecidos (o de todos, con `MAS_VENDIDOS`), cuántos lo compran. */
  clientes: z.number().int().nonnegative(),
  /** Lo que compra al mes de media cada uno de esos clientes, en unidades. */
  unidadesMes: z.number().nonnegative(),
});
export type ProductoOferta = z.infer<typeof productoOfertaSchema>;

export const ofertaClienteSchema = z.object({
  basadoEn: z.enum(['PARECIDOS', 'MAS_VENDIDOS']),
  /** Con cuántos clientes se le comparó. */
  comparadoCon: z.number().int().nonnegative(),
  /** Cuántos productos ASTA distintos compra él. */
  compraAsta: z.number().int().nonnegative(),
  productos: z.array(productoOfertaSchema),
});
export type OfertaCliente = z.infer<typeof ofertaClienteSchema>;
export const ofertaClienteRespuestaSchema = z.object({ data: ofertaClienteSchema });
