import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';
import { rangoSchema } from './reportes.js';

/**
 * Qué compran los clientes de un vendedor, producto a producto, en un periodo.
 *
 * Se mira desde dos lados, y el servidor da los dos ya sumados (la regla de
 * `montoSchema`: el panel no acumula importes):
 *
 *   · por categoría → sus productos → los clientes que compran cada uno;
 *   · por cliente   → en qué categorías compra.
 *
 * ── Los importes ─────────────────────────────────────────────────────────────
 *
 * SIN impuestos y en la moneda de la compañía: el `balance` de las líneas de
 * factura, con el signo cambiado. Las notas de crédito restan, también en las
 * cantidades. Por eso no cuadra con el «Facturado» de los reportes, que es el
 * total de la factura con IVA.
 */

export const clienteDeProductoSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  cantidad: z.number(),
  monto: montoSchema,
});

export const productoDelReporteSchema = z.object({
  productId: odooIdSchema,
  /** Referencia interna, la que se dicta por teléfono. */
  sku: z.string().nullable(),
  nombre: z.string(),
  marca: z.string().nullable(),
  esAsta: z.boolean(),
  cantidad: z.number(),
  monto: montoSchema,
  /** Quiénes lo compran, de más a menos. */
  clientes: z.array(clienteDeProductoSchema),
});

/** El id de la categoría en Odoo, o 0 si el producto no tiene ficha legible. */
const categoriaIdSchema = z.number().int().nonnegative();

export const categoriaDelReporteSchema = z.object({
  categoriaId: categoriaIdSchema,
  nombre: z.string(),
  monto: montoSchema,
  /** Lo que de ese monto es de la marca propia. */
  montoAsta: montoSchema,
  /**
   * true si ASTA tiene producto en la categoría. Fuera de ellas no hay cuota que
   * medir: el cliente no elige otra marca, es que ASTA no fabrica eso.
   */
  enCompetencia: z.boolean(),
  /** Clientes distintos que compraron algo de la categoría. */
  clientes: z.number().int().nonnegative(),
  productos: z.array(productoDelReporteSchema),
});

export const clienteDelReporteProductosSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  monto: montoSchema,
  montoAsta: montoSchema,
  productosDistintos: z.number().int().nonnegative(),
  /** En qué compra, de más a menos. */
  categorias: z.array(z.object({ categoriaId: categoriaIdSchema, nombre: z.string(), monto: montoSchema })),
});

export const reporteProductosRespuestaSchema = z.object({
  periodo: rangoSchema,
  totales: z.object({
    monto: montoSchema,
    montoAsta: montoSchema,
    /** Lo vendido en las categorías donde ASTA compite: la base de su cuota, como en «Oportunidades ASTA». */
    montoEnCompetencia: montoSchema,
    clientes: z.number().int().nonnegative(),
    productos: z.number().int().nonnegative(),
  }),
  categorias: z.array(categoriaDelReporteSchema),
  clientes: z.array(clienteDelReporteProductosSchema),
  /**
   * Lo que se factura con un producto que NO es una venta y por eso no entra en
   * nada de lo de arriba: «Saldo Inicial» (`SAL_INI`), con el que se cargaron
   * los saldos de apertura. Se dice cuánto, para que no parezca que falta.
   */
  apartados: z.array(
    z.object({
      sku: z.string(),
      nombre: z.string(),
      monto: montoSchema,
      clientes: z.number().int().nonnegative(),
    }),
  ),
  meta: z.object({
    generadoEn: z.iso.datetime(),
    /** true si sale de la caché del middleware: puede tener unos minutos. */
    desdeCache: z.boolean(),
  }),
});

export type ProductoDelReporte = z.infer<typeof productoDelReporteSchema>;
export type CategoriaDelReporte = z.infer<typeof categoriaDelReporteSchema>;
export type ClienteDelReporteProductos = z.infer<typeof clienteDelReporteProductosSchema>;
export type ReporteProductos = z.infer<typeof reporteProductosRespuestaSchema>;
