import { z } from 'zod';
import { montoSchema, odooDateSchema, odooIdSchema } from './common.js';

/**
 * «Impulsa a tus clientes» (#40): qué hacer hoy con cada cliente.
 *
 * Primera versión, una sola acción: «Pásale a ASTA». El cliente compra un
 * consumible de otra marca (HP, Canon, Epson…) que tiene un equivalente ASTA
 * con existencias en su almacén; se le sugiere al vendedor que se lo ofrezca.
 *
 * Las sugerencias se calculan de Odoo; lo que el vendedor hace con ellas
 * (hecha, pospuesta) se guarda en el panel (`impulsa_acciones`).
 */

export const estadoImpulsaSchema = z.enum(['ACTIVA', 'HECHA', 'POSPUESTA']);
export type EstadoImpulsa = z.infer<typeof estadoImpulsaSchema>;

export const tipoImpulsaSchema = z.enum(['pasale_a_asta']);
export type TipoImpulsa = z.infer<typeof tipoImpulsaSchema>;

export const alternativaAstaSchema = z.object({
  productId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  /** Unidades libres en el almacén del cliente. Siempre más de 0: sin existencias no se sugiere. */
  disponible: z.number(),
});

export const sugerenciaPasaleSchema = z.object({
  /** Qué sugerencia es, para marcarla: el id del producto original. */
  clave: z.string(),
  original: z.object({
    productId: odooIdSchema,
    sku: z.string().nullable(),
    nombre: z.string(),
    /** Lo que gastó en él en la ventana, sin IVA y neto de devoluciones. */
    monto: montoSchema,
    cantidad: z.number(),
    facturas: z.number().int().nonnegative(),
    ultimaCompra: odooDateSchema,
  }),
  /** Los ASTA que le sirven, con más existencias primero. Al menos uno. */
  asta: z.array(alternativaAstaSchema).min(1),
  /** Lo que el vendedor hizo con ella; null si nada. */
  marca: z
    .object({
      estado: estadoImpulsaSchema,
      /** Hasta cuándo no sale, si está pospuesta. */
      hasta: odooDateSchema.nullable(),
    })
    .nullable(),
  /**
   * false si está hecha (y el cliente no ha vuelto a comprar el original) o
   * pospuesta y todavía no ha llegado la fecha. Llega igual, para poder
   * deshacer.
   */
  visible: z.boolean(),
});

export const clienteImpulsaSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  /** Lo que gastó en los originales de sus sugerencias visibles: lo que está en juego. */
  enJuego: montoSchema,
  sugerencias: z.array(sugerenciaPasaleSchema).min(1),
});

export const impulsaRespuestaSchema = z.object({
  data: z.array(clienteImpulsaSchema),
  meta: z.object({
    /** Lo pendiente: sugerencias visibles, sus clientes y lo que gastaron en los originales. */
    pendientes: z.object({
      clientes: z.number().int().nonnegative(),
      sugerencias: z.number().int().nonnegative(),
      enJuego: montoSchema,
    }),
    /** Lo que el vendedor ya atendió: hechas o pospuestas que no tocan hoy. */
    atendidas: z.number().int().nonnegative(),
    /** La ventana de compras que se mira. */
    ventana: z.object({ desde: odooDateSchema, hasta: odooDateSchema }),
    reglas: z.object({
      /** Gasto mínimo en el original dentro de la ventana. */
      montoMinimo: z.number(),
      /** La última compra del original, como mucho hace estos días. */
      diasDesdeUltimaCompra: z.number().int().positive(),
    }),
    generadoEn: z.iso.datetime(),
    /** true si las sugerencias salen de la caché del middleware (unos minutos). */
    desdeCache: z.boolean(),
  }),
});

export type AlternativaAsta = z.infer<typeof alternativaAstaSchema>;
export type SugerenciaPasale = z.infer<typeof sugerenciaPasaleSchema>;
export type ClienteImpulsa = z.infer<typeof clienteImpulsaSchema>;
export type ImpulsaRespuesta = z.infer<typeof impulsaRespuestaSchema>;

/** Cuerpo de `POST /salesperson/clients/:partnerId/impulsa`. */
export const marcarImpulsaSchema = z.object({
  tipo: tipoImpulsaSchema,
  clave: z.string().regex(/^\d{1,12}$/),
  estado: estadoImpulsaSchema,
  /** Solo con POSPUESTA: cuántos días. */
  dias: z.union([z.literal(7), z.literal(30)]).optional(),
});

export type MarcarImpulsa = z.infer<typeof marcarImpulsaSchema>;
