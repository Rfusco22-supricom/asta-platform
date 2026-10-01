import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * Catálogo, existencias y precios. Superficie de la API pública (Track B).
 *
 * Regla que atraviesa todo este archivo: el producto que sale de aquí NUNCA
 * lleva `standard_price` (el costo) ni `list_price` crudo. El cliente ve el
 * precio de su tarifa y nada más. Un campo de costo filtrado en una respuesta
 * JSON es información comercial regalada a quien negocia contigo.
 */

export const stockStatusSchema = z.enum(['disponible', 'bajo', 'agotado']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const productSchema = z.object({
  id: odooIdSchema,
  /** product.template.id — el que agrupa variantes. */
  templateId: odooIdSchema,
  sku: z.string().nullable(),
  nombre: z.string(),
  descripcion: z.string().nullable(),
  marca: z.string().nullable(),
  /**
   * Precio ya resuelto según la tarifa del solicitante, derivada del token y
   * jamás de la petición. Ver `pricing.service.ts` (#31).
   */
  precio: montoSchema,
  /** ID de la tarifa aplicada. Se expone para que el cliente pueda auditarlo. */
  pricelistId: odooIdSchema.nullable(),
  /**
   * Existencia. Se publica como estado y no como número exacto salvo que el
   * negocio decida lo contrario: la cantidad precisa es información logística
   * que no todos los clientes deberían ver.
   */
  stock: stockStatusSchema,
  cantidadDisponible: z.number().nullable(),
  /** Rendimiento del tóner en páginas, cuando aplica. */
  rendimientoPaginas: z.number().int().positive().nullable(),
  color: z.string().nullable(),
  /** Original de fábrica vs compatible/genérico. */
  tipo: z.enum(['original', 'compatible', 'desconocido']),
});

export type Product = z.infer<typeof productSchema>;

/**
 * Query de `GET /api/v1/public/inventory` (#30).
 *
 * Pagina igual que `/invoices` (`pagina`/`porPagina`), y no por cursor: la API
 * pública ya tiene esa forma y un cliente integrado no debería aprender dos.
 *
 * `soloDisponibles` usa `z.stringbool()` y no `z.coerce.boolean()`: el segundo
 * hace `Boolean("false")`, que es `true`. Con él, `?soloDisponibles=false`
 * filtraba.
 *
 * `printerId` se acepta en el schema para poder rechazarlo con un mensaje claro
 * mientras no exista la compatibilidad impresora-tóner (#56). Ignorarlo en
 * silencio devolvería el catálogo entero a quien pidió "los tóners de esta
 * impresora".
 */
export const inventoryQuerySchema = z.object({
  sku: z.string().min(1).optional().describe('Referencia exacta del producto.'),
  /** Búsqueda libre sobre nombre y referencia. */
  q: z.string().min(2).optional().describe('Busca en el nombre y la referencia, sin distinguir mayúsculas. Mínimo 2 caracteres.'),
  printerId: z.coerce.number().int().positive().optional().describe(
    'Reservado para filtrar por impresora compatible. Todavía no disponible: responde 400.',
  ),
  soloDisponibles: z.stringbool().default(false).describe('`true` para devolver solo productos con existencia (`disponible` o `bajo`).'),
  pagina: z.coerce.number().int().positive().default(1).describe('Página, empezando en 1.'),
  porPagina: z.coerce.number().int().positive().max(100).default(50).describe('Resultados por página, hasta 100.'),
});

export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

/** Máximo de referencias por consulta de precios. */
export const MAX_SKUS_PRECIOS = 100;

/**
 * Query de `GET /api/v1/public/pricing` (#31): precios en lote.
 *
 * Existe en lote a propósito: sin ella, un cliente que quiere cotizar 50 SKUs
 * hace 50 requests. Con él son dos lecturas a Odoo, sean 1 o 100.
 *
 * Separadas por comas, y no con el parámetro repetido: ninguna de las 3.762
 * referencias de la instancia lleva coma, y `?skus=A&skus=B` llega a Express
 * como un array que es fácil leer a medias. Las repetidas se cuentan una vez.
 *
 * NO hay parámetro de tarifa ni de compañía, y no debe haberlo: la tarifa sale
 * del cliente de la API key. Ver `pricing.service.ts`.
 */
export const pricingQuerySchema = z.object({
  skus: z
    .string()
    .min(1)
    .describe(
      `Referencias de producto separadas por comas, hasta ${MAX_SKUS_PRECIOS}. ` +
        'Exactas, distinguiendo mayúsculas. Codifica la URL: algunas referencias llevan `+`, `#` o espacios.',
    )
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.string()).min(1, 'skus no trae ninguna referencia').max(MAX_SKUS_PRECIOS, `Como mucho ${MAX_SKUS_PRECIOS} referencias por consulta`)),
});

export type PricingQuery = z.infer<typeof pricingQuerySchema>;

/**
 * Por qué una referencia no trae precio, o `ok` si lo trae.
 *
 * `sin_precio_en_tarifa` cubre tanto la regla que no existe como la que vale
 * 0.00: en esta instancia el 84 % de los productos tiene algún 0.00 en las
 * tarifas principales, y publicarlo como precio sería un incidente comercial.
 */
export const motivoPrecioSchema = z.enum(['ok', 'sku_no_encontrado', 'sku_ambiguo', 'sin_precio_en_tarifa']);
export type MotivoPrecio = z.infer<typeof motivoPrecioSchema>;

export const publicPriceSchema = z.object({
  sku: z.string().describe('La referencia, tal como se pidió.'),
  productId: odooIdSchema.nullable().describe('Identificador del producto, el mismo de `/inventory`. `null` si no se encontró.'),
  precio: montoSchema
    .nullable()
    .describe('Precio unitario de tu tarifa, sin impuestos, en la moneda de `meta.moneda`. `null` cuando no hay precio: nunca se publica 0.'),
  motivo: motivoPrecioSchema.describe(
    '`ok`, o por qué no hay precio: `sku_no_encontrado` (no existe o no está a la venta), `sku_ambiguo` ' +
      '(la referencia la comparten varios productos) o `sin_precio_en_tarifa`. Puede recibir valores nuevos: trata cualquier otro como «sin precio».',
  ),
});

export type PublicPrice = z.infer<typeof publicPriceSchema>;

export const publicPricingResponseSchema = z.object({
  data: z.array(publicPriceSchema).describe('Una entrada por referencia pedida, en el mismo orden.'),
  meta: z.object({
    moneda: z.string().describe('Moneda de los precios (ISO 4217), la de tu tarifa.'),
    desdeCache: z.boolean().describe('`true` si algún precio sale de la cache: puede tener hasta 5 minutos de antigüedad.'),
  }),
});

export type PublicPricingResponse = z.infer<typeof publicPricingResponseSchema>;

/**
 * Un producto tal como lo devuelve `GET /api/v1/public/inventory`.
 *
 * Sin precio: sale de `/pricing` (#31), que lo resuelve con la tarifa del
 * cliente. Publicar aquí `list_price` sería peor que no publicar nada — en esta
 * instancia vale 1 en productos cuyo precio base es 65.
 *
 * Sin cantidad: solo el estado. Ver `stockStatusSchema` y la decisión en #30.
 */
export const publicInventoryItemSchema = z.object({
  id: odooIdSchema.describe('Identificador del producto.'),
  templateId: odooIdSchema.describe('Identificador del producto base que agrupa sus variantes.'),
  sku: z.string().nullable().describe('Referencia del producto. `null` si no tiene.'),
  nombre: z.string().describe('Nombre del producto.'),
  categoria: z.string().nullable().describe('Categoría del producto. `null` si no tiene.'),
  /** Existencia libre (física menos reservada) en el almacén que vende al cliente. */
  stock: stockStatusSchema.describe(
    'Existencia en el almacén que te vende, descontando lo ya reservado: `disponible`, `bajo` ' +
      '(pocas unidades) o `agotado`. Puede recibir valores nuevos: trata cualquier otro como `agotado`.',
  ),
});

export type PublicInventoryItem = z.infer<typeof publicInventoryItemSchema>;

export const publicInventoryListResponseSchema = z.object({
  data: z.array(publicInventoryItemSchema),
  meta: z.object({
    pagina: z.number().int().positive().describe('Página devuelta.'),
    porPagina: z.number().int().positive().describe('Tamaño de página aplicado.'),
    total: z.number().int().nonnegative().describe('Total de productos con estos filtros, en todas las páginas.'),
    /** true si la página salió de la cache de 60 s. */
    desdeCache: z.boolean().describe('`true` si la respuesta sale de la cache: puede tener hasta 60 segundos de antigüedad.'),
  }),
});

export type PublicInventoryListResponse = z.infer<typeof publicInventoryListResponseSchema>;
