type Clausula = [string, string, unknown];

/**
 * Qué cuenta como «facturado» en todo el panel. Decidido en #26: **neto de
 * devoluciones**.
 *
 * ── Por qué neto ─────────────────────────────────────────────────────────────
 *
 * Es lo que el vendedor cree que está viendo: si un cliente devolvió mercancía,
 * ese dinero no es negocio conseguido. Y es lo que cuadra con el «por cobrar» de
 * la misma tarjeta, que es neto por definición — una nota de crédito reduce lo
 * que el cliente debe. Con dos criterios en la misma pantalla, las cifras no
 * cuadran entre sí, y eso es lo que hace que el vendedor deje de fiarse.
 *
 * Medido en producción el 2026-10-01: 1.870 notas de crédito, -547.298,84 sobre
 * 35,2 M facturados (1,6 %).
 *
 * ── Lo que NO cambia ─────────────────────────────────────────────────────────
 *
 * - **Los conteos son de facturas.** Una devolución resta dinero, no suma una
 *   factura: «181 facturas» sigue siendo 181 aunque haya dos notas de crédito.
 * - **«Última compra» es la última factura.** Una devolución no es una compra.
 * - **La lista de documentos de la API pública** (#32) sigue siendo de facturas:
 *   es un listado, no un total, y su dominio es además un filtro de seguridad.
 *
 * ── El signo, que es donde se equivoca uno ───────────────────────────────────
 *
 * En `account.move`, los campos `*_signed` ya vienen en negativo en las notas de
 * crédito: basta con sumar. En `account.move.line`, `price_subtotal` y
 * `quantity` vienen en POSITIVO también en las devoluciones (verificado contra
 * la instancia): hay que agrupar por `move_type` y aplicar el signo aquí, con
 * `plegarPorTipo(..., { firmar: true })`.
 */

export const FACTURA = 'out_invoice';
export const NOTA_DE_CREDITO = 'out_refund';

/** Los tipos de documento que entran en cualquier total de facturación. */
export const TIPOS_FACTURADO = [FACTURA, NOTA_DE_CREDITO];

/** Cláusula de dominio para `account.move`. */
export const TIPO_FACTURADO: Clausula = ['move_type', 'in', TIPOS_FACTURADO];

/** La misma cláusula, para `account.move.line`. */
export const TIPO_FACTURADO_LINEA: Clausula = ['move_id.move_type', 'in', TIPOS_FACTURADO];

/** Criterio que viaja en las respuestas, para que la pantalla diga cómo suma. */
export const CRITERIO = { netoDeDevoluciones: true } as const;

interface GrupoConTipo {
  move_type?: string | false;
  __count: number;
}

export interface Plegado {
  sumas: Record<string, number>;
  /** Solo facturas: las notas de crédito no cuentan como documento vendido. */
  facturas: number;
}

/**
 * Junta los grupos de un `read_group` agrupado además por `move_type`.
 *
 * `clave` dice a qué fila pertenece cada grupo (un cliente, un mes, un estado de
 * pago); `null` lo descarta. Con `firmar`, las notas de crédito restan: es lo que
 * necesitan los campos de línea, que vienen en positivo. Sin `firmar`, se suman
 * tal cual, que es lo correcto para los `*_signed` de `account.move`.
 */
export function plegarPorTipo<G extends GrupoConTipo, K>(
  grupos: G[],
  clave: (g: G) => K | null,
  campos: string[],
  { firmar = false }: { firmar?: boolean } = {},
): Map<K, Plegado> {
  const mapa = new Map<K, Plegado>();
  for (const g of grupos) {
    const k = clave(g);
    if (k === null) continue;

    const esNota = g.move_type === NOTA_DE_CREDITO;
    const signo = firmar && esNota ? -1 : 1;

    let fila = mapa.get(k);
    if (!fila) {
      fila = { sumas: Object.fromEntries(campos.map((c) => [c, 0])), facturas: 0 };
      mapa.set(k, fila);
    }
    for (const c of campos) {
      fila.sumas[c] += signo * (Number((g as Record<string, unknown>)[c]) || 0);
    }
    if (!esNota) fila.facturas += g.__count;
  }
  return mapa;
}
