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
  tier: z.string().nullable(),
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

export const clientProfileSchema = z.object({
  cliente: partnerSchema,
  tierNormalizado: clientTierSchema.nullable(),
  /** null si nunca ha comprado. */
  diasSinComprar: z.number().int().nonnegative().nullable(),
  topProductos: z.array(topProductSchema),
  notas: z.array(clientNoteSchema),
});

export type ClientProfile = z.infer<typeof clientProfileSchema>;
export type TopProduct = z.infer<typeof topProductSchema>;
