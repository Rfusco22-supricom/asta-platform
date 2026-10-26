import { z } from 'zod';
import { odooIdSchema } from './common.js';

/**
 * Las tablets del kiosco, dadas de alta desde el panel (#40, #120).
 *
 * Las de Supricom tienen almacén y enseñan existencias. Las de los clientes
 * (las vincula cada cliente desde su cuenta) y las de los revisores de las
 * tiendas de apps no tienen almacén: solo compatibilidades.
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
  /** `null`: sin almacén, la tablet enseña solo compatibilidades (las de clientes y revisores). */
  odooCompanyId: odooIdSchema.nullable(),
  odooWarehouseId: odooIdSchema.nullable(),
  /** El cliente dueño. `null`: una tablet de Supricom. */
  odooPartnerId: odooIdSchema.nullable(),
  /** Nombre del cliente dueño, si lo hay. */
  cliente: z.string().nullable(),
  /** Nombres de Odoo. `null` si Odoo no respondió o no tiene almacén: la lista sale igual. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Vincular una tablet con un código del panel
// ─────────────────────────────────────────────────────────────────────────────

/** Un cliente vincula una tablet de su tienda: solo compatibilidades, sin existencias. */
export const nuevoCodigoClienteSchema = z.object({
  nombre: z.string().trim().min(2).max(100),
  tienda: z.string().trim().max(150).optional(),
});

export type NuevoCodigoCliente = z.infer<typeof nuevoCodigoClienteSchema>;

/**
 * El código sale UNA vez. 6 dígitos que caducan en minutos; el de los revisores
 * de las tiendas de apps, 12 y sin caducidad (`expiraEn: null`).
 */
export const codigoTabletRespuestaSchema = z.object({
  data: z.object({ id: z.uuid(), codigo: z.string(), expiraEn: z.iso.datetime().nullable() }),
});

export type CodigoTablet = z.infer<typeof codigoTabletRespuestaSchema>['data'];

/** Para que el panel diga solo «✓ Tablet conectada». */
export const estadoCodigoTabletRespuestaSchema = z.object({
  data: z.object({
    estado: z.enum(['PENDIENTE', 'USADO', 'CADUCADO', 'REVOCADO']),
    tablet: z.object({ id: z.uuid(), nombre: z.string() }).nullable(),
  }),
});

export type EstadoCodigoTablet = z.infer<typeof estadoCodigoTabletRespuestaSchema>['data'];

/** Lo que manda la tablet con el código. Plataforma y modelo, para reconocerla en la lista. */
export const vincularTabletSchema = z.object({
  /** Se aceptan espacios y guiones: «482 913» es como se lee en la pantalla. */
  codigo: z.string().transform((c) => c.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{6}$|^\d{12}$/)),
  plataforma: z.enum(['ios', 'android']),
  modelo: z.string().trim().max(100).optional(),
  version: z.string().trim().max(20).optional(),
});

export type VincularTablet = z.input<typeof vincularTabletSchema>;

/** El token sale UNA vez, a la tablet. `conExistencias: false`: solo compatibilidades. */
export const tabletVinculadaRespuestaSchema = z.object({
  data: z.object({ token: z.string(), nombre: z.string(), conExistencias: z.boolean() }),
});

/** El código para los revisores de Apple y Google, como lo ve el administrador. */
export const codigoRevisionRespuestaSchema = z.object({
  data: z
    .object({
      id: z.uuid(),
      creadoEn: z.iso.datetime(),
      usos: z.number().int(),
      ultimoUso: z.iso.datetime().nullable(),
    })
    .nullable(),
});

export type CodigoRevision = z.infer<typeof codigoRevisionRespuestaSchema>['data'];
