import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';
import { clientTierSchema } from './identity.js';

/**
 * Clientes y cartera. Superficie del módulo de vendedores (Track A).
 *
 * Alineado con `apps/middleware/src/services/partners.service.ts`.
 */

export const partnerSchema = z.object({
  id: odooIdSchema,
  nombre: z.string(),
  email: z.email().nullable(),
  telefono: z.string().nullable(),
  /** res.users.id del vendedor asignado en Odoo. */
  vendedorOdooUserId: odooIdSchema.nullable(),
  vendedorNombre: z.string().nullable(),
  /**
   * Empresa matriz. Cuando el partner es un contacto hijo, este es el ID bajo el
   * que hay que consolidar la facturación. Si no tiene padre, es su propio id.
   */
  commercialPartnerId: odooIdSchema,
  pricelistId: odooIdSchema.nullable(),
  /**
   * Valor crudo de `x_client_tier` tal como viene de Odoo, sin normalizar.
   * Es `string` y no el enum a propósito: hasta que cierre el issue #3 no
   * sabemos si Odoo devuelve "gold", "Gold" o un many2one. Normalizar aquí
   * escondería el desajuste en vez de exponerlo.
   */
  tier: z.string().nullable(),
});

export type Partner = z.infer<typeof partnerSchema>;

/** Fila de la tabla de cartera del vendedor. */
export const portfolioRowSchema = z.object({
  id: odooIdSchema,
  nombre: z.string(),
  email: z.email().nullable(),
  telefono: z.string().nullable(),
  /** Nombre de la tarifa tal como viene de Odoo, sin normalizar. */
  tier: z.string().nullable(),
  /** Nivel derivado de la tarifa (ver TierPricelistMap). Es lo que pinta el badge. */
  tierDerivado: clientTierSchema,
  totalFacturado: montoSchema,
  porCobrar: montoSchema,
  numeroFacturas: z.number().int().nonnegative(),
  /** false = prospecto asignado que nunca ha comprado. El panel los separa, no los oculta. */
  esCliente: z.boolean(),
});

export type PortfolioRow = z.infer<typeof portfolioRowSchema>;

export const portfolioMetaSchema = z.object({
  clientes: z.number().int().nonnegative(),
  totalCartera: montoSchema,
  porCobrarCartera: montoSchema,
});

export type PortfolioMeta = z.infer<typeof portfolioMetaSchema>;

/**
 * Perfilado del cliente (issue #24). Las notas viven en Postgres, no en Odoo:
 * son datos operativos del panel, no del ERP.
 */
export const clientNoteSchema = z.object({
  id: z.uuid(),
  autorNombre: z.string(),
  texto: z.string().min(1).max(4000),
  creadoEn: z.iso.datetime(),
});

export type ClientNote = z.infer<typeof clientNoteSchema>;

export const topProductSchema = z.object({
  productId: odooIdSchema,
  nombre: z.string(),
  sku: z.string().nullable(),
  cantidad: z.number(),
  monto: montoSchema,
});

export const recenciaSchema = z.enum(['activo', 'atencion', 'inactivo', 'sin_compras']);
export type EstadoRecencia = z.infer<typeof recenciaSchema>;

export const clientProfileSchema = z.object({
  partnerId: odooIdSchema,
  /** null si nunca ha comprado. */
  diasSinComprar: z.number().int().nonnegative().nullable(),
  ultimaCompra: z.iso.date().nullable(),
  estadoRecencia: recenciaSchema,
  /**
   * Los umbrales viajan en la respuesta en vez de estar duplicados en el panel.
   * Si mañana el area comercial decide que 60 dias son 45, se cambia en un solo
   * sitio y el panel se entera sin desplegar.
   */
  umbrales: z.object({
    atencion: z.number().int().positive(),
    inactivo: z.number().int().positive(),
  }),
  topProductos: z.array(topProductSchema),
  productosDistintos: z.number().int().nonnegative(),
  /** Suma de price_subtotal: SIN impuestos, a diferencia del total facturado. */
  montoEnProductos: montoSchema,
  notas: z.array(clientNoteSchema),
  /**
   * false mientras `client_notes` no exista (#12).
   *
   * Se distingue de un array vacio a proposito: "este cliente no tiene notas" y
   * "todavia no podemos guardar notas" son dos cosas distintas, y el panel debe
   * poder decir cual de las dos.
   */
  notasDisponibles: z.boolean(),
});

export type ClientProfile = z.infer<typeof clientProfileSchema>;
export type TopProduct = z.infer<typeof topProductSchema>;
