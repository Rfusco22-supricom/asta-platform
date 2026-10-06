import { z } from 'zod';
import { montoSchema } from './common.js';

/**
 * Calidad de los datos que llegan de Odoo.
 *
 * Cada revisión es un dato que está mal EN ODOO y que el panel no puede arreglar
 * —solo enseñar—: un cliente sin vendedor no sale en ninguna cartera, una
 * factura sin vendedor no cuenta en ningún reporte, un RIF con el dígito mal no
 * agrupa los duplicados. Se arregla en Odoo y la fila desaparece sola en la
 * siguiente lectura.
 */

export const claveRevisionSchema = z.enum([
  'SIN_VENDEDOR',
  'VENDEDOR_INACTIVO',
  'FACTURAS_SIN_VENDEDOR',
  'RIF_INVALIDO',
  'SIN_CORREO',
  'NOMBRE_VENDEDOR',
  'ESPACIOS_EN_NOMBRE',
]);
export type ClaveRevision = z.infer<typeof claveRevisionSchema>;

/**
 * · `alta`  — descuadra dinero o carteras: hay facturación que nadie ve.
 * · `media` — rompe algo concreto: un cliente que no puede entrar, un duplicado que no se detecta.
 * · `baja`  — se ve feo, no rompe nada.
 */
export const gravedadSchema = z.enum(['alta', 'media', 'baja']);
export type Gravedad = z.infer<typeof gravedadSchema>;

export const hallazgoSchema = z.object({
  /** Id del registro en Odoo: un cliente (`res.partner`) o un usuario (`res.users`). */
  id: z.number().int().positive(),
  nombre: z.string(),
  /** Qué tiene mal, en una frase: «J316776517: el dígito final debería ser 8». */
  detalle: z.string(),
  compania: z.string().nullable(),
  vendedor: z.string().nullable(),
  /** Facturado en los últimos 12 meses: ordena la lista por lo que importa. */
  facturado: montoSchema,
});
export type Hallazgo = z.infer<typeof hallazgoSchema>;

export const revisionSchema = z.object({
  clave: claveRevisionSchema,
  gravedad: gravedadSchema,
  titulo: z.string(),
  /** Qué se rompe mientras siga así. */
  porQue: z.string(),
  /** Dónde se arregla en Odoo: el camino de menús, y una nota si hace falta. */
  comoArreglar: z.object({ ruta: z.array(z.string()).min(1), nota: z.string().nullable() }),
  /** De qué es cada fila: «clientes», «facturas», «vendedores». */
  unidad: z.string(),
  total: z.number().int().nonnegative(),
  /** Facturado en 12 meses por todo lo afectado. */
  facturado: montoSchema,
  /** Las primeras, de más facturado a menos. */
  muestra: z.array(hallazgoSchema),
});
export type Revision = z.infer<typeof revisionSchema>;

export const calidadDatosSchema = z.object({
  /** Clientes activos de primer nivel examinados. */
  clientes: z.number().int().nonnegative(),
  revisiones: z.array(revisionSchema),
});
export type CalidadDatos = z.infer<typeof calidadDatosSchema>;

export const calidadDatosRespuestaSchema = z.object({
  data: calidadDatosSchema,
  meta: z.object({
    generadoEn: z.iso.datetime(),
    duracionMs: z.number().int().nonnegative(),
    desdeCache: z.boolean(),
  }),
});
