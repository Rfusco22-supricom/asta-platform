import { z } from 'zod';
import { odooIdSchema } from './common.js';

/**
 * Las tablets del kiosco, dadas de alta desde el panel (#40, #120).
 *
 * Cada tablet tiene su propio token, no una API key de cliente: una tablet no
 * tiene cliente, atiende a quien entre por la puerta. El token solo abre las
 * rutas del recomendador (`/api/v1/kiosk/...`), y las existencias son las del
 * almacén de esa tienda.
 */

export const kioscoSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  tienda: z.string(),
  odooCompanyId: odooIdSchema,
  odooWarehouseId: odooIdSchema,
  /** Nombres de Odoo. `null` si Odoo no respondió: la lista sale igual. */
  almacen: z.string().nullable(),
  compania: z.string().nullable(),
  activo: z.boolean(),
  /** La última vez que la tablet pidió algo. `null`: todavía no se ha conectado. */
  ultimaConexion: z.iso.datetime().nullable(),
  version: z.string().nullable(),
  creadoEn: z.iso.datetime(),
});

export type Kiosco = z.infer<typeof kioscoSchema>;

export const kioscosRespuestaSchema = z.object({
  data: z.array(kioscoSchema),
  meta: z.object({ odooDisponible: z.boolean() }),
});

export type KioscosRespuesta = z.infer<typeof kioscosRespuestaSchema>;

export const almacenKioscoSchema = z.object({
  warehouseId: odooIdSchema,
  nombre: z.string(),
  codigo: z.string().nullable(),
  companyId: odooIdSchema,
  compania: z.string(),
});

export type AlmacenKiosco = z.infer<typeof almacenKioscoSchema>;

export const almacenesKioscoRespuestaSchema = z.object({ data: z.array(almacenKioscoSchema) });

export const nuevoKioscoSchema = z.object({
  nombre: z.string().trim().min(3).max(100),
  tienda: z.string().trim().min(2).max(150),
  odooWarehouseId: odooIdSchema.max(4_294_967_295),
});

export type NuevoKiosco = z.infer<typeof nuevoKioscoSchema>;

/** El token en claro sale UNA vez, al crearlo o al pedir uno nuevo. No se guarda. */
export const kioscoConTokenRespuestaSchema = z.object({
  data: z.object({ kiosco: kioscoSchema, token: z.string() }),
});

export type KioscoConToken = z.infer<typeof kioscoConTokenRespuestaSchema>['data'];

export const cambioKioscoSchema = z.object({ activo: z.boolean() });

export const kioscoRespuestaSchema = z.object({ data: kioscoSchema });
