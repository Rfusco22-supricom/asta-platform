import { z } from 'zod';
import { odooIdSchema } from './common.js';

/**
 * «Mis flyers»: el cliente elige una plantilla de ASTA y el panel le pone los
 * datos de su tienda, listo para Instagram o WhatsApp. La imagen se dibuja en
 * su navegador; de aquí salen solo los datos de su tienda (de su ficha en
 * Odoo, que puede cambiar antes de descargar) y los productos ASTA con foto.
 */

export const tiendaFlyerSchema = z.object({
  nombre: z.string(),
  telefono: z.string().nullable(),
  /** Calle y ciudad, en una línea. */
  direccion: z.string().nullable(),
});
export type TiendaFlyer = z.infer<typeof tiendaFlyerSchema>;

export const productoFlyerSchema = z.object({
  /** `product.template`: la foto es de la plantilla. */
  templateId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  /** Si nos lo ha comprado en los últimos meses: salen primero. */
  loCompra: z.boolean(),
});
export type ProductoFlyer = z.infer<typeof productoFlyerSchema>;

export const datosFlyerSchema = z.object({
  tienda: tiendaFlyerSchema,
  /** Los productos ASTA a la venta que tienen foto. */
  productos: z.array(productoFlyerSchema),
});
export type DatosFlyer = z.infer<typeof datosFlyerSchema>;
export const datosFlyerRespuestaSchema = z.object({ data: datosFlyerSchema });
