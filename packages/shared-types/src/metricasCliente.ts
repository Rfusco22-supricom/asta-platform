import { z } from 'zod';
import { invoicingSummarySchema } from './invoicing.js';
import { clientProfileSchema } from './partners.js';
import { clienteCategoriaSchema } from './categoriasAsta.js';

/**
 * «Mis métricas»: lo que un CLIENTE ve de sí mismo en el panel, con datos que
 * ya existen (fase 1 del sell-out): sus compras de ASTA, su nivel en el
 * programa y lo que buscan los clientes en sus tablets.
 *
 * Cada bloque es `null` si no se pudo leer: los demás salen igual.
 */
export const metricasClienteSchema = z.object({
  periodo: z.object({ desde: z.iso.date(), hasta: z.iso.date() }),
  /** Sus compras de ASTA en el periodo, con la serie mes a mes. */
  compras: invoicingSummarySchema.nullable(),
  /** Qué compra (de todo su historial) y cuánto hace que no compra. Sin las notas del vendedor. */
  perfil: clientProfileSchema.omit({ notas: true, notasDisponibles: true }).nullable(),
  /**
   * Su nivel en el programa ASTA. `cliente: null` si no compra ASTA en los
   * meses de la ventana: no está en el programa todavía.
   */
  nivel: z
    .object({
      meses: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
      cliente: clienteCategoriaSchema.nullable(),
    })
    .nullable(),
  /** Lo que se busca en SUS tablets. `null` si no tiene ninguna. */
  tablets: z
    .object({
      cuantas: z.number().int().nonnegative(),
      busquedas: z.number().int().nonnegative(),
      sinResultado: z.number().int().nonnegative(),
      impresoras: z.array(z.object({ marca: z.string().nullable(), nombre: z.string().nullable(), veces: z.number().int().positive() })),
      sinEncontrar: z.array(z.object({ texto: z.string(), veces: z.number().int().positive() })),
    })
    .nullable(),
});

export type MetricasCliente = z.infer<typeof metricasClienteSchema>;

export const metricasClienteRespuestaSchema = z.object({ data: metricasClienteSchema });
