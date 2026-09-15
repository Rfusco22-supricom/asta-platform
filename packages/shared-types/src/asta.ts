import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * Cuota de la marca propia frente a la competencia, cliente a cliente.
 *
 * ASTA fabrica consumibles y compite en sus categorías con HP, Canon, Epson y
 * Brother. Medido sobre facturas contabilizadas, tiene el 11,9 % de ese mercado
 * dentro de la propia cartera de la empresa, y hay 860 clientes que compran
 * consumibles sin haber comprado ASTA nunca.
 *
 * El mismo dato se sirve por dos puertas distintas —`/admin/asta` con todo,
 * `/salesperson/asta` acotado a la cartera de quien pide— y no por una que mire
 * el rol: un endpoint que decide su propio alcance según quién llama es donde
 * acaba colándose la cartera de otro.
 */

export const oportunidadAstaSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  /** El comercial asignado en Odoo, si lo tiene. */
  vendedorOdooUserId: odooIdSchema.nullable(),
  vendedorNombre: z.string().nullable(),

  /** Gasto en consumibles de marca ASTA. */
  asta: montoSchema,
  /** Gasto en consumibles de las demás marcas. */
  competencia: montoSchema,
  /** Porcentaje del gasto en consumibles que va a ASTA, con un decimal. */
  cuota: z.number(),
});

export type OportunidadAsta = z.infer<typeof oportunidadAstaSchema>;

export const astaRespuestaSchema = z.object({
  data: z.array(oportunidadAstaSchema),
  meta: z.object({
    clientes: z.number().int().nonnegative(),
    asta: montoSchema,
    competencia: montoSchema,
    cuota: z.number(),
    /** Clientes que compran consumibles y nunca han comprado ASTA. */
    sinAsta: z.number().int().nonnegative(),
    sinAstaImporte: montoSchema,
    generadoEn: z.iso.datetime(),
    duracionMs: z.number().int().nonnegative(),
  }),
});

export type AstaRespuesta = z.infer<typeof astaRespuestaSchema>;
