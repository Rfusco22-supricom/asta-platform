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
