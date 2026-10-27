import { z } from 'zod';
import { invoicingSummarySchema } from './invoicing.js';
import { clientProfileSchema } from './partners.js';
import { evaluacionTrimestreSchema } from './programaAsta.js';

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
   * Su nivel en el programa ASTA (`programaAsta.ts`): cómo va en el trimestre
   * en curso y los tokens que lleva de los ya cerrados. Su nivel de ahora es
   * `evaluacion.nivel`.
   */
  programa: z
    .object({
      saldoTokens: z.number().int().nonnegative(),
      evaluacion: evaluacionTrimestreSchema,
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
