import { z } from 'zod';

/**
 * La demanda no cubierta de ASTA, sacada de la aplicación ASTA de las tiendas:
 * impresoras que la gente encuentra al buscar, pero para las que ASTA todavía
 * no tiene producto. Es lo que habría que fabricar, importar o validar.
 *
 * Cada impresora buscada queda en uno de cuatro estados, mirando sus
 * compatibilidades HOY (no las del día de la búsqueda: lo que importa es lo que
 * sigue sin cubrir):
 *
 *   · CUBIERTA    — tiene al menos un producto ASTA validado: la aplicación lo enseña;
 *   · POR_VALIDAR — hay un producto ASTA propuesto para ella, sin validar;
 *   · SIN_ASTA    — se sabe qué cartuchos usa, pero ASTA no tiene ninguno;
 *   · SIN_DATOS   — ni siquiera se sabe qué cartuchos usa.
 *
 * Las búsquedas que no encontraron ninguna impresora son otra cosa (un alias
 * que falta) y se ven en «Recomendador».
 */

export const ESTADOS_DEMANDA = ['CUBIERTA', 'POR_VALIDAR', 'SIN_ASTA', 'SIN_DATOS'] as const;
export const estadoDemandaSchema = z.enum(ESTADOS_DEMANDA);
export type EstadoDemanda = z.infer<typeof estadoDemandaSchema>;

/** Filas como mucho en cada lista. */
export const TOPE_DEMANDA = 50;

export const impresoraDemandadaSchema = z.object({
  printerModelId: z.number().int(),
  marca: z.string(),
  nombre: z.string(),
  estado: estadoDemandaSchema,
  /** Cuántas veces se buscó en el periodo. */
  busquedas: z.number().int().nonnegative(),
  /** En cuántas tablets distintas; las búsquedas por API no cuentan aquí. */
  tablets: z.number().int().nonnegative(),
  ultimaVez: z.string(),
  /** Los cartuchos que usa, según las compatibilidades validadas. */
  cartuchos: z.array(z.string()),
});
export type ImpresoraDemandada = z.infer<typeof impresoraDemandadaSchema>;

export const cartuchoDemandadoSchema = z.object({
  codigo: z.string(),
  marca: z.string(),
  /** Búsquedas de impresoras SIN_ASTA que usan este cartucho. */
  busquedas: z.number().int().nonnegative(),
  impresoras: z.array(z.string()),
});
export type CartuchoDemandado = z.infer<typeof cartuchoDemandadoSchema>;

export const demandaAstaSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
  totales: z.object({
    /** Búsquedas que llegaron a una impresora. */
    conImpresora: z.number().int().nonnegative(),
    /** De ellas, con producto ASTA para ofrecer. */
    cubiertas: z.number().int().nonnegative(),
    porValidar: z.number().int().nonnegative(),
    sinAsta: z.number().int().nonnegative(),
    sinDatos: z.number().int().nonnegative(),
    /** Búsquedas que no encontraron ninguna impresora. */
    sinImpresora: z.number().int().nonnegative(),
  }),
  /** Las impresoras no cubiertas, de la más buscada a la menos. */
  impresoras: z.array(impresoraDemandadaSchema),
  /** Los cartuchos de las impresoras SIN_ASTA, por las búsquedas que cubrirían. */
  cartuchos: z.array(cartuchoDemandadoSchema),
});
export type DemandaAsta = z.infer<typeof demandaAstaSchema>;
export const demandaAstaRespuestaSchema = z.object({ data: demandaAstaSchema });
