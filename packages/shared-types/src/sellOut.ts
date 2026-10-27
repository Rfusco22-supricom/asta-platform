import { z } from 'zod';
import { odooIdSchema } from './common.js';
import { claveCategoriaSchema } from './categoriasAsta.js';

/**
 * Sell-out de los clientes (fase 2): lo que cada cliente vende de ASTA a sus
 * propios clientes. Lo reporta él, por mes y producto, de una de dos formas:
 *
 *   · VENTAS      — las unidades que vendió en el mes;
 *   · INVENTARIO  — lo que le queda al cierre del mes. Con dos meses seguidos,
 *                   lo vendido se calcula: lo que tenía + lo que compró a
 *                   Supricom − lo que le queda.
 *
 * Sube un Excel (o CSV) con la plantilla del panel: código ASTA y cantidad.
 */

export const tipoSellOutSchema = z.enum(['VENTAS', 'INVENTARIO']);
export type TipoSellOut = z.infer<typeof tipoSellOutSchema>;

export const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** El archivo viaja en base64: unos pocos cientos de filas, no hace falta multipart. */
export const subirSellOutSchema = z.object({
  mes: mesSchema,
  tipo: tipoSellOutSchema,
  nombre: z.string().trim().min(1).max(200),
  archivo: z.string().min(1).max(3_000_000),
});

export type SubirSellOut = z.infer<typeof subirSellOutSchema>;

const incidenciaSchema = z.object({ fila: z.number().int().positive(), codigo: z.string(), motivo: z.string() });

/** Lo que sale de comprobar el archivo, antes de guardarlo. */
export const validacionSellOutSchema = z.object({
  /** Productos distintos que se guardarían. */
  productos: z.number().int().nonnegative(),
  unidades: z.number(),
  /** Si hay alguno, no se guarda nada. */
  errores: z.array(incidenciaSchema),
  /** Se guarda igual: códigos repetidos que se suman, por ejemplo. */
  avisos: z.array(incidenciaSchema),
  /** Si ya había un reporte de ese mes y tipo, que este sustituiría. */
  reemplaza: z.boolean(),
});

export type ValidacionSellOut = z.infer<typeof validacionSellOutSchema>;

export const reporteSellOutSchema = z.object({
  id: z.uuid(),
  mes: mesSchema,
  tipo: tipoSellOutSchema,
  archivo: z.string(),
  filas: z.number().int().nonnegative(),
  unidades: z.number(),
  subidoEn: z.iso.datetime(),
  vigente: z.boolean(),
});

export type ReporteSellOut = z.infer<typeof reporteSellOutSchema>;

/** De dónde sale lo vendido de un mes: reportado, calculado del inventario, o nada. */
export const fuenteSellOutSchema = z.enum(['VENTAS', 'INVENTARIO']).nullable();

export const productoSellOutSchema = z.object({
  productId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  /** Lo que compró a Supricom en el mes. */
  compradas: z.number(),
  /** `null` si ese mes no hay reporte del que sacarlo. */
  vendidas: z.number().nullable(),
  existencia: z.number().nullable(),
  /** Para cuántos días le alcanza la existencia al ritmo de venta. */
  diasInventario: z.number().nullable(),
  /** Le quedan menos de `DIAS_REPONER` días. */
  reponer: z.boolean(),
});

export type ProductoSellOut = z.infer<typeof productoSellOutSchema>;

/** «Mi sell-out» de un cliente. */
export const resumenSellOutSchema = z.object({
  meses: z.array(
    z.object({
      mes: mesSchema,
      compradas: z.number(),
      vendidas: z.number().nullable(),
      existencia: z.number().nullable(),
      fuente: fuenteSellOutSchema,
    }),
  ),
  /** El último mes con algo reportado, y sus productos. */
  mesProductos: mesSchema.nullable(),
  productos: z.array(productoSellOutSchema),
  reportes: z.array(reporteSellOutSchema),
});

export type ResumenSellOut = z.infer<typeof resumenSellOutSchema>;

export const resumenSellOutRespuestaSchema = z.object({ data: resumenSellOutSchema });
export const validacionSellOutRespuestaSchema = z.object({ data: validacionSellOutSchema });
export const reporteSellOutRespuestaSchema = z.object({ data: reporteSellOutSchema });

/** El sell-out de toda la empresa en un mes, para el administrador. */
export const sellOutEmpresaSchema = z.object({
  mes: mesSchema,
  totales: z.object({
    clientesReportan: z.number().int().nonnegative(),
    vendidas: z.number(),
    compradas: z.number(),
    /** Lo que los clientes tienen en su almacén: el inventario en el canal. */
    existencia: z.number(),
  }),
  clientes: z.array(
    z.object({
      partnerId: odooIdSchema,
      nombre: z.string(),
      compradas: z.number(),
      vendidas: z.number().nullable(),
      existencia: z.number().nullable(),
      fuente: fuenteSellOutSchema,
    }),
  ),
  /** Clientes del programa (Bronce y arriba) que no han reportado ese mes. */
  sinReportar: z.array(z.object({ partnerId: odooIdSchema, nombre: z.string(), categoria: claveCategoriaSchema, vendedor: z.string().nullable() })),
  productos: z.array(z.object({ productId: odooIdSchema, sku: z.string().nullable(), nombre: z.string(), vendidas: z.number(), existencia: z.number() })),
});

export type SellOutEmpresa = z.infer<typeof sellOutEmpresaSchema>;

export const sellOutEmpresaRespuestaSchema = z.object({ data: sellOutEmpresaSchema });

/**
 * «Lo que te vendimos»: los productos ASTA que el cliente nos compró, con lo
 * que ha marcado como vendido y lo que le queda. Lo que marca es su reporte de
 * VENTAS del mes, el mismo que si subiera el Excel.
 */
export const productoPorMarcarSchema = z.object({
  productId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  /** Lo que tenía en su último conteo de inventario, si lo hay. */
  base: z.number(),
  /** Lo que nos compró desde `desde`. */
  compradas: z.number(),
  /** Lo vendido desde `desde`, reportado o calculado. */
  vendidas: z.number(),
  /** base + compradas − vendidas, nunca menos de 0. */
  quedan: z.number(),
  /** Lo vendido en `mes`, el que se está marcando. */
  vendidasMes: z.number(),
});

export type ProductoPorMarcar = z.infer<typeof productoPorMarcarSchema>;

export const porMarcarSchema = z.object({
  /** El mes que se marca: el actual o el anterior. */
  mes: mesSchema,
  /** Primer mes que se cuenta. */
  desde: mesSchema,
  /** El mes del conteo de inventario del que se parte, si se parte de uno. */
  inventario: mesSchema.nullable(),
  productos: z.array(productoPorMarcarSchema),
});

export type PorMarcar = z.infer<typeof porMarcarSchema>;

export const porMarcarRespuestaSchema = z.object({ data: porMarcarSchema });

/** Cuántas vendió de un producto en el mes: el total, no lo que suma. */
export const marcarVendidoSchema = z.object({
  mes: mesSchema,
  productId: odooIdSchema,
  cantidad: z.number().min(0).max(1_000_000),
});

export type MarcarVendido = z.infer<typeof marcarVendidoSchema>;
