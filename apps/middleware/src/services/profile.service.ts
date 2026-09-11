import { executeKw, readGroup, searchRead, type OdooDomain } from '../odoo/client.js';

/**
 * Perfilado del cliente (issue #24).
 *
 * Responde a lo que un vendedor necesita antes de llamar a un cliente: cuánto
 * hace que no compra y qué le suele comprar.
 *
 * ── Lo que NO está aquí ──────────────────────────────────────────────────────
 *
 * Las notas del vendedor viven en MySQL (`client_notes`), que todavía no está
 * montado (#12). El endpoint devuelve `notasDisponibles: false` en vez de un
 * array vacío: no es lo mismo "este cliente no tiene notas" que "todavía no
 * podemos guardar notas", y el panel tiene que poder decir cuál de las dos.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Umbrales de inactividad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A partir de cuántos días sin comprar se considera que un cliente se está
 * enfriando.
 *
 * ATENCIÓN: estos números me los he inventado. Son un punto de partida
 * razonable, no una regla de negocio confirmada — en un negocio de consumibles
 * el ciclo de recompra depende del tipo de cliente, y 60 días puede ser normal
 * para uno y alarmante para otro.
 *
 * Hay que validarlos con el área comercial antes de que el panel empiece a
 * pintar clientes en rojo, o los vendedores aprenderán a ignorar el color.
 */
export const UMBRAL_ATENCION_DIAS = 60;
export const UMBRAL_INACTIVO_DIAS = 120;

export type EstadoRecencia = 'activo' | 'atencion' | 'inactivo' | 'sin_compras';

export function clasificarRecencia(dias: number | null): EstadoRecencia {
  if (dias === null) return 'sin_compras';
  if (dias >= UMBRAL_INACTIVO_DIAS) return 'inactivo';
  if (dias >= UMBRAL_ATENCION_DIAS) return 'atencion';
  return 'activo';
}

// ─────────────────────────────────────────────────────────────────────────────

export interface TopProducto {
  productId: number;
  nombre: string;
  sku: string | null;
  cantidad: number;
  monto: number;
}

export interface ClientProfile {
  partnerId: number;
  /** Días desde la última factura contabilizada. null = nunca ha comprado. */
  diasSinComprar: number | null;
  ultimaCompra: string | null;
  estadoRecencia: EstadoRecencia;
  umbrales: { atencion: number; inactivo: number };
  topProductos: TopProducto[];
  productosDistintos: number;
  /** Suma de `price_subtotal`: SIN impuestos, a diferencia del total facturado. */
  montoEnProductos: number;
  notas: never[];
  /** false mientras no exista MySQL. Ver #12 y #24. */
  notasDisponibles: boolean;
}

interface LineGroup {
  product_id: [number, string] | false;
  quantity: number;
  price_subtotal: number;
  __count: number;
}

interface InvoiceRow {
  invoice_date: string | false;
}

/**
 * Separa "[SKU] Nombre del producto" en sus dos partes.
 *
 * Odoo concatena la referencia interna al nombre en el display_name de los
 * many2one. Mostrarlo tal cual en una tabla es ilegible, y el SKU por separado
 * es lo que el vendedor dicta por teléfono.
 */
function partirNombre(display: string): { sku: string | null; nombre: string } {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(display.trim());
  return m ? { sku: m[1], nombre: m[2] || display } : { sku: null, nombre: display };
}

/**
 * Perfil de un cliente. Cuesta 3 RPC, independientemente de su histórico.
 *
 * OJO con el `display_type`: en Odoo 17 las líneas de factura NO tienen
 * `display_type = false`. Los valores son 'product', 'cogs', 'tax',
 * 'payment_term', 'line_section'... Filtrar por `= false` devuelve cero filas,
 * y filtrar por `!= false` devuelve TODAS, incluidas las de coste e impuestos,
 * que duplicarían los importes. Hay que pedir `= 'product'` explícitamente.
 */
export async function getClientProfile(
  partnerId: number,
  limiteTop = 5,
): Promise<ClientProfile> {
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new TypeError(`partnerId inválido: ${partnerId}`);
  }

  // Las sucursales cuentan como compras del mismo cliente.
  const familia = await executeKw<number[]>('res.partner', 'search', [
    [['id', 'child_of', partnerId]],
  ]);

  const lineasBase: OdooDomain = [
    ['parent_state', '=', 'posted'],
    ['move_type', '=', 'out_invoice'],
    ['partner_id', 'in', familia],
    ['display_type', '=', 'product'],
    ['product_id', '!=', false],
  ];

  const [grupos, ultimas] = await Promise.all([
    readGroup<LineGroup>(
      'account.move.line',
      lineasBase,
      ['quantity:sum', 'price_subtotal:sum'],
      ['product_id'],
    ),
    searchRead<InvoiceRow>(
      'account.move',
      [
        ['partner_id', 'child_of', partnerId],
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
      ],
      ['invoice_date'],
      { limit: 1, order: 'invoice_date desc, id desc' },
    ),
  ]);

  const conProducto = grupos.filter((g) => g.product_id);
  conProducto.sort((a, b) => (b.price_subtotal ?? 0) - (a.price_subtotal ?? 0));

  const topProductos: TopProducto[] = conProducto.slice(0, limiteTop).map((g) => {
    const [id, display] = g.product_id as [number, string];
    const { sku, nombre } = partirNombre(display);
    return {
      productId: id,
      nombre,
      sku,
      cantidad: Math.round((g.quantity ?? 0) * 100) / 100,
      monto: Math.round((g.price_subtotal ?? 0) * 100) / 100,
    };
  });

  const ultimaCompra = ultimas[0]?.invoice_date || null;
  let diasSinComprar: number | null = null;

  if (ultimaCompra) {
    // En UTC y a medianoche: comparar contra la hora local daría un día de más
    // o de menos según cuándo se consulte, y "59 días" vs "60" cambia el color
    // que ve el vendedor.
    const hoy = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    const fecha = Date.parse(`${ultimaCompra}T00:00:00Z`);
    diasSinComprar = Number.isNaN(fecha)
      ? null
      : Math.max(0, Math.round((hoy - fecha) / 86_400_000));
  }

  return {
    partnerId,
    diasSinComprar,
    ultimaCompra,
    estadoRecencia: clasificarRecencia(diasSinComprar),
    umbrales: { atencion: UMBRAL_ATENCION_DIAS, inactivo: UMBRAL_INACTIVO_DIAS },
    topProductos,
    productosDistintos: conProducto.length,
    montoEnProductos:
      Math.round(conProducto.reduce((s, g) => s + (g.price_subtotal ?? 0), 0) * 100) / 100,
    notas: [],
    notasDisponibles: false,
  };
}
