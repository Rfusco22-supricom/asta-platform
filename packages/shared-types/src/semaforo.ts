import { z } from 'zod';

/**
 * El semáforo de clientes: las impresoras que un cliente nos compró y si les
 * compra el tóner ASTA. Lo pidió un vendedor (nov-2026): cruzar la compra de
 * impresoras con las compatibilidades del panel para saber a quién ofrecerle
 * ASTA y qué.
 *
 * ── Las reglas ───────────────────────────────────────────────────────────────
 *
 *   · Impresoras: las facturadas al cliente en el periodo del filtro (por
 *     defecto, los últimos `MESES_SEMAFORO` meses), netas de devoluciones,
 *     reconocidas en `printer_models`. Lo de ASTA, la última compra y el
 *     tamaño se miran en el mismo periodo.
 *   · Una impresora está CUBIERTA si el cliente compró en ese tiempo alguno de
 *     sus tóners ASTA (compatibilidad VALIDADA). Las que no tienen tóner ASTA
 *     no cuentan para el color: no hay nada que ofrecerle.
 *   · El color, por las impresoras con tóner ASTA:
 *       ROJO      ninguna cubierta;
 *       AMARILLO  algunas;
 *       VERDE     todas.
 *   · Sin comprar ASTA más de `DIAS_SIN_ASTA` días (pedido del 25-nov-2026):
 *     baja un color, VERDE → AMARILLO y AMARILLO → ROJO. Compró para sus
 *     impresoras, pero dejó de hacerlo: hay que llamarlo.
 *   · El tamaño de la tienda, por su compra total (todas las marcas) en el
 *     mismo tiempo frente a la de los demás clientes de la empresa: GRANDE el
 *     20 % que más compra, MEDIANA el 30 % siguiente, PEQUENA el resto. Sin
 *     montos: el panel solo enseña importes de ASTA.
 */

export const MESES_SEMAFORO = 12;

export const COLORES_SEMAFORO = ['ROJO', 'AMARILLO', 'VERDE'] as const;
export const colorSemaforoSchema = z.enum(COLORES_SEMAFORO);
export type ColorSemaforo = z.infer<typeof colorSemaforoSchema>;

export const TAMANOS_TIENDA = ['GRANDE', 'MEDIANA', 'PEQUENA'] as const;
export const tamanoTiendaSchema = z.enum(TAMANOS_TIENDA);
export type TamanoTienda = z.infer<typeof tamanoTiendaSchema>;

/** Percentiles del tamaño: por encima del 80 %, GRANDE; del 50 %, MEDIANA. */
export const CORTE_GRANDE = 0.8;
export const CORTE_MEDIANA = 0.5;

/** El tamaño por la posición de su compra entre la de todos (0 = el que menos, 1 = el que más). */
export function tamanoDe(percentil: number): TamanoTienda {
  if (percentil >= CORTE_GRANDE) return 'GRANDE';
  if (percentil >= CORTE_MEDIANA) return 'MEDIANA';
  return 'PEQUENA';
}

/** Días sin comprar ASTA a partir de los cuales el cliente baja un color. Un trimestre. */
export const DIAS_SIN_ASTA = 90;

/**
 * El color por las impresoras con tóner ASTA, las cubiertas y los días desde su
 * última compra de ASTA (`null`: ninguna en el periodo). `null`: ninguna
 * impresora tiene ASTA.
 */
export function colorDe(conAsta: number, cubiertas: number, diasSinAsta: number | null = 0): ColorSemaforo | null {
  if (conAsta === 0) return null;
  if (cubiertas === 0) return 'ROJO';
  const color = cubiertas < conAsta ? 'AMARILLO' : 'VERDE';
  if (diasSinAsta === null || diasSinAsta > DIAS_SIN_ASTA) return color === 'VERDE' ? 'AMARILLO' : 'ROJO';
  return color;
}

/** Días enteros entre una fecha «YYYY-MM-DD» y hoy. */
export function diasDesde(fecha: string | null, hoy: string): number | null {
  if (!fecha) return null;
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86_400_000);
}

export const tonerSemaforoSchema = z.object({
  odooProductTmplId: z.number().int(),
  /** Referencia de Odoo, «A-CB435A-CE278A-CE285A». */
  sku: z.string().nullable(),
  nombre: z.string(),
  /** Lo compró en el periodo. */
  comprado: z.boolean(),
});
export type TonerSemaforo = z.infer<typeof tonerSemaforoSchema>;

export const impresoraSemaforoSchema = z.object({
  /** null: el producto de Odoo no se reconoce como ninguna impresora de la base. */
  printerModelId: z.number().int().nullable(),
  /** «Canon imageCLASS LBP6030w», o el nombre del producto si no se reconoce. */
  nombre: z.string(),
  unidades: z.number(),
  /** Sus tóners ASTA validados; vacío si no tiene. */
  toners: z.array(tonerSemaforoSchema),
  cubierta: z.boolean(),
});
export type ImpresoraSemaforo = z.infer<typeof impresoraSemaforoSchema>;

export const clienteSemaforoSchema = z.object({
  partnerId: z.number().int(),
  nombre: z.string(),
  /** El comercial asignado; solo en la vista de administración. */
  vendedor: z.string().nullable(),
  tamano: tamanoTiendaSchema,
  color: colorSemaforoSchema,
  /** Unidades de impresora en el periodo. */
  impresoras: z.number(),
  /** Modelos con tóner ASTA, y de ellos los cubiertos. */
  conAsta: z.number().int().nonnegative(),
  cubiertas: z.number().int().nonnegative(),
  /** Su última factura con ASTA en el periodo, «YYYY-MM-DD»; null si ninguna. */
  ultimaCompraAsta: z.string().nullable(),
  /** Días desde esa compra; null si ninguna. */
  diasSinAsta: z.number().int().nullable(),
  /** Bajó un color por llevar más de `DIAS_SIN_ASTA` días sin comprar ASTA. */
  enfriado: z.boolean(),
  detalle: z.array(impresoraSemaforoSchema),
});
export type ClienteSemaforo = z.infer<typeof clienteSemaforoSchema>;

export const semaforoSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
  totales: z.object({
    ROJO: z.number().int().nonnegative(),
    AMARILLO: z.number().int().nonnegative(),
    VERDE: z.number().int().nonnegative(),
    /** Unidades de impresora vendidas a los clientes del semáforo. */
    impresoras: z.number(),
  }),
  clientes: z.array(clienteSemaforoSchema),
});
export type Semaforo = z.infer<typeof semaforoSchema>;

export const semaforoRespuestaSchema = z.object({ data: semaforoSchema });
