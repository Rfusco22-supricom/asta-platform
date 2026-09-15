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
  /** Sin validar, por lo mismo que en `portfolioRowSchema`: se pinta, no se usa. */
  email: z.string().nullable(),
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
  /**
   * Tal como está en Odoo, SIN validar.
   *
   * Era `z.email()`, y un solo carácter tiraba la pantalla entera: el cliente
   * ASG-Z SECURITY LANTECH tiene `"A"` en el campo de correo, y con eso el
   * vendedor 428 no veía ninguno de sus 161 clientes — la respuesta completa
   * fallaba el contrato por UNA fila. Hay ocho correos así en la instancia, cada
   * uno capaz de apagarle la cartera a quien lo tenga.
   *
   * Aquí este campo se PINTA, no se usa para escribir a nadie. Validarlo
   * convierte un problema de calidad de dato en Odoo —que además ya se reporta
   * en el informe de reconciliación— en una caída de la herramienta.
   *
   * Donde sí se valida es al crear la cuenta: `esEmailPlausible` en el sync, que
   * es justo por lo que estos clientes no tienen acceso al panel.
   */
  email: z.string().nullable(),
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
export const LARGO_MAXIMO_NOTA = 4000;

export const clientNoteSchema = z.object({
  id: z.uuid(),
  autorNombre: z.string(),
  /** null si el autor se dio de baja. El nombre se conserva igualmente. */
  autorId: z.uuid().nullable(),
  texto: z.string().min(1).max(LARGO_MAXIMO_NOTA),
  creadoEn: z.iso.datetime(),
  /** true si la escribió quien está mirando: solo esas se pueden borrar. */
  esMia: z.boolean(),
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

/**
 * Otros registros de Odoo que son el MISMO cliente (issue #50).
 *
 * El 34,5 % de lo facturado está repartido entre duplicados. Los totales del
 * panel son exactos para el registro que se mira y aun así incompletos como
 * retrato del cliente; esto es lo que permite decirlo en su ficha.
 */
export const hermanoSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  /** `rif` identifica; `nombre` solo se parece. */
  motivo: z.enum(['rif', 'nombre']),
  facturado: montoSchema,
  facturas: z.number().int().nonnegative(),
  vendedorNombre: z.string().nullable(),
});

export type Hermano = z.infer<typeof hermanoSchema>;

export const hermanosRespuestaSchema = z.object({
  data: z.object({
    esteRegistro: montoSchema,
    /** Lo facturado sumando este registro y sus hermanos. */
    total: montoSchema,
    hermanos: z.array(hermanoSchema),
  }),
});

export type HermanosRespuesta = z.infer<typeof hermanosRespuestaSchema>;
