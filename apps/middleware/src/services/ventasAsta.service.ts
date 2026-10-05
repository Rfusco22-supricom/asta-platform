import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { MARCA_ASTA } from './asta.service.js';
import { FACTURA, NOTA_DE_CREDITO, TIPO_FACTURADO_LINEA } from './criterioFacturacion.js';
import type { InvoicingQuery, InvoicingSummary } from './invoicing.service.js';
import { compras, enRango, smartbit, ventasDeClientes, ventasSmartbitDeCliente } from './smartbit.service.js';

/**
 * Lo que el panel del vendedor cuenta: ASTA, y solo ASTA (decisión del 2-oct-2026).
 *
 * De cada factura cuentan sus LÍNEAS de producto ASTA, sin IVA y en la moneda
 * de la compañía (`-balance` de la línea), con las notas de crédito restando.
 * Una factura con un portátil y un tóner ASTA suma el tóner. «La última compra»
 * es la última factura con ASTA; «por cobrar», el saldo entero de las facturas
 * que llevan algo de ASTA, porque Odoo no dice qué línea se pagó.
 *
 * Lo que el cliente compra de otras marcas no desaparece del panel: es la
 * materia de «Oportunidades ASTA» (`asta.service.ts`), que sigue mirándolo.
 *
 * Medido el 5-oct-2026 en la cartera de DANIEL ESPINOZA: 22.710 de ASTA frente
 * a 1.019.792 de facturación total, y 41 clientes con ASTA de 94 con facturas.
 */

/** Una línea es de ASTA si su producto es de la marca propia. */
export const LINEA_ASTA: OdooDomain[number] = ['product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA];

/** Una factura «con ASTA» lleva al menos una línea de la marca. */
export const FACTURA_CON_ASTA: OdooDomain[number] = ['invoice_line_ids.product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA];

/** Las líneas ASTA de facturas y notas de crédito contabilizadas. */
export const LINEAS_ASTA: OdooDomain = [['display_type', '=', 'product'], ['parent_state', '=', 'posted'], TIPO_FACTURADO_LINEA, LINEA_ASTA];

/**
 * La cartera de un vendedor dicha desde la LÍNEA de factura: las tres
 * condiciones de `dominioCartera`. El `active` hay que escribirlo: al recorrer
 * un many2one, Odoo 17 busca sin `active_test` (ver `reporteProductos.service`).
 * Es mucho más rápido que `partner_id in [cientos de ids]`.
 */
export function carteraDesdeLinea(odooUserId: number): OdooDomain {
  return [
    ['partner_id.user_id', '=', odooUserId],
    ['partner_id.parent_id', '=', false],
    ['partner_id.active', '=', true],
  ];
}

/** Lo mismo desde la factura: su cliente comercial es de la cartera. */
export function carteraDesdeFactura(odooUserId: number): OdooDomain {
  return [
    ['commercial_partner_id.user_id', '=', odooUserId],
    ['commercial_partner_id.parent_id', '=', false],
    ['commercial_partner_id.active', '=', true],
  ];
}

function rangoLinea(query: Pick<InvoicingQuery, 'desde' | 'hasta'>): OdooDomain {
  const d: OdooDomain = [];
  if (query.desde) d.push(['invoice_date', '>=', query.desde]);
  if (query.hasta) d.push(['invoice_date', '<=', query.hasta]);
  return d;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface TotalAsta {
  /** Vendido en ASTA, sin IVA, neto de devoluciones. */
  total: number;
  /** Saldo de las facturas con ASTA. */
  porCobrar: number;
  /** Facturas de venta con ASTA (las notas de crédito no son una compra). */
  facturas: number;
}

/**
 * Lo de ASTA de cada cliente, en dos `read_group` en paralelo: de la cartera de
 * un vendedor, o de toda la empresa con `null` (la vista de administración).
 * Los clientes sin ASTA no salen: el llamante los rellena a cero.
 *
 * Con `conSmartbit`, los ids de la cartera (o la promesa de ellos, para no
 * esperarlos antes de preguntar a Odoo), suma también la historia de
 * Smartbit de cada uno de ellos (`smartbit.service`): lo vendido y las compras,
 * no el saldo. Sin él, solo Odoo.
 */
export async function totalesAstaDeCartera(
  odooUserId: number | null,
  query: Pick<InvoicingQuery, 'desde' | 'hasta'> = {},
  conSmartbit?: number[] | Promise<number[]>,
): Promise<Map<number, TotalAsta>> {
  const [lineas, facturas, sb] = await Promise.all([
    readGroup<{ partner_id: [number, string] | false; balance: number }>(
      'account.move.line',
      [...LINEAS_ASTA, ...(odooUserId === null ? [] : carteraDesdeLinea(odooUserId)), ...rangoLinea(query)],
      ['balance:sum'],
      ['partner_id'],
    ),
    readGroup<{ commercial_partner_id: [number, string] | false; move_type: string | false; amount_residual_signed: number; __count: number }>(
      'account.move',
      [
        ['state', '=', 'posted'],
        ['move_type', 'in', [FACTURA, NOTA_DE_CREDITO]],
        FACTURA_CON_ASTA,
        ...(odooUserId === null ? [] : carteraDesdeFactura(odooUserId)),
        ...rangoLinea(query),
      ],
      ['amount_residual_signed:sum'],
      ['commercial_partner_id', 'move_type'],
    ),
    conSmartbit ? Promise.all([smartbit(), conSmartbit]) : null,
  ]);

  const r = new Map<number, TotalAsta>();
  const de = (id: number) => {
    const t = r.get(id) ?? { total: 0, porCobrar: 0, facturas: 0 };
    r.set(id, t);
    return t;
  };
  for (const g of lineas) if (g.partner_id) de(g.partner_id[0]).total += -g.balance;
  for (const g of facturas) {
    if (!g.commercial_partner_id) continue;
    const t = de(g.commercial_partner_id[0]);
    t.porCobrar += g.amount_residual_signed;
    if (g.move_type === FACTURA) t.facturas += g.__count;
  }
  if (sb) {
    for (const [id, ventas] of ventasDeClientes(...sb)) {
      const delRango = ventas.filter((v) => enRango(v, query));
      if (delRango.length === 0) continue;
      const t = de(id);
      t.total += delRango.reduce((s, v) => s + v.venta, 0);
      t.facturas += compras(delRango).length;
    }
  }
  for (const t of r.values()) {
    t.total = redondear(t.total);
    t.porCobrar = redondear(t.porCobrar);
  }
  return r;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-07-15" → "julio 2026", como etiqueta Odoo sus grupos por mes (lo que espera `GraficaMensual`). */
function etiquetaMes(fecha: string): string {
  const [y, m] = fecha.split('-').map(Number) as [number, number];
  return `${MESES[m - 1]} ${y}`;
}

interface FacturaLeida {
  id: number;
  name: string;
  move_type: string;
  invoice_date: string | false;
  payment_state: NonNullable<NonNullable<InvoicingSummary['ultimaFactura']>['estadoPago']> | false;
  amount_total_signed: number;
  amount_residual_signed: number;
}

/**
 * El resumen de la ficha de un cliente, solo ASTA. Misma forma que
 * `getPartnerInvoicingSummary`, para que la ficha no cambie de contrato:
 *
 *   · `totalFacturado`, `ticketPromedio`, `serieMensual` y el `monto` del
 *     desglose y de la última factura: lo ASTA de cada factura;
 *   · `porCobrar` y el `saldo` del desglose: el saldo de las facturas con ASTA;
 *   · `cobrado`: lo cobrado de esas facturas (su total menos su saldo), así que
 *     el «% cobrado» es `cobrado / (cobrado + porCobrar)`.
 *
 * Con la historia de Smartbit de su RIF (`smartbit.service`): suma a lo
 * vendido, las facturas (cada compra), el ticket y la serie. No al saldo, al
 * desglose por estado de pago ni a `ultimaFactura`, que son de facturas de Odoo.
 *
 * Cuesta 2 RPC: las líneas ASTA agrupadas por factura, y esas facturas.
 */
export async function resumenAstaDeCliente(partnerId: number, query: InvoicingQuery = {}): Promise<InvoicingSummary> {
  if (!Number.isInteger(partnerId) || partnerId <= 0) throw new TypeError(`partnerId inválido: ${partnerId}`);

  // Las sucursales cuentan como el cliente, igual que en `buildDomain`.
  const [porFactura, ventasSb] = await Promise.all([
    readGroup<{ move_id: [number, string] | false; balance: number }>(
      'account.move.line',
      [...LINEAS_ASTA, ['move_id.partner_id', 'child_of', partnerId], ...rangoLinea(query)],
      ['balance:sum'],
      ['move_id'],
    ),
    ventasSmartbitDeCliente(partnerId).then((vs) => vs.filter((v) => enRango(v, query))),
  ]);
  const astaDe = new Map<number, number>();
  for (const g of porFactura) if (g.move_id) astaDe.set(g.move_id[0], (astaDe.get(g.move_id[0]) ?? 0) - g.balance);

  const facturas = astaDe.size
    ? await searchRead<FacturaLeida>(
        'account.move',
        [['id', 'in', [...astaDe.keys()]]],
        ['id', 'name', 'move_type', 'invoice_date', 'payment_state', 'amount_total_signed', 'amount_residual_signed'],
      )
    : [];

  let total = 0;
  let porCobrar = 0;
  let totalFacturas = 0;
  let numeroFacturas = 0;
  const porEstado = new Map<string, { monto: number; saldo: number; facturas: number }>();
  const porMes = new Map<string, { inicio: string; monto: number; facturas: number }>();
  let ultima: FacturaLeida | null = null;

  for (const f of facturas) {
    const asta = astaDe.get(f.id) ?? 0;
    const esFactura = f.move_type === FACTURA;
    total += asta;
    porCobrar += f.amount_residual_signed;
    totalFacturas += f.amount_total_signed;
    if (esFactura) numeroFacturas++;

    const estado = f.payment_state || 'desconocido';
    const e = porEstado.get(estado) ?? { monto: 0, saldo: 0, facturas: 0 };
    e.monto += asta;
    e.saldo += f.amount_residual_signed;
    if (esFactura) e.facturas++;
    porEstado.set(estado, e);

    if (f.invoice_date) {
      const clave = f.invoice_date.slice(0, 7);
      const m = porMes.get(clave) ?? { inicio: f.invoice_date, monto: 0, facturas: 0 };
      m.monto += asta;
      if (esFactura) m.facturas++;
      porMes.set(clave, m);
    }

    // La última COMPRA: una devolución no lo es.
    if (esFactura && f.invoice_date && (!ultima || !ultima.invoice_date || f.invoice_date > ultima.invoice_date || (f.invoice_date === ultima.invoice_date && f.id > ultima.id))) {
      ultima = f;
    }
  }

  for (const v of ventasSb) {
    total += v.venta;
    const m = porMes.get(v.fecha.slice(0, 7)) ?? { inicio: v.fecha, monto: 0, facturas: 0 };
    m.monto += v.venta;
    porMes.set(v.fecha.slice(0, 7), m);
  }
  for (const c of compras(ventasSb)) {
    numeroFacturas++;
    porMes.get(c.fecha.slice(0, 7))!.facturas++;
  }

  const summary: InvoicingSummary = {
    partnerId,
    currency: 'company',
    totalFacturado: redondear(total),
    porCobrar: redondear(porCobrar),
    cobrado: redondear(totalFacturas - porCobrar),
    numeroFacturas,
    ticketPromedio: numeroFacturas > 0 ? redondear(total / numeroFacturas) : 0,
    desglosePorEstadoDePago: [...porEstado].map(([estado, e]) => ({
      estado: estado as InvoicingSummary['desglosePorEstadoDePago'][number]['estado'],
      monto: redondear(e.monto),
      saldo: redondear(e.saldo),
      facturas: e.facturas,
    })),
    ultimaFactura: ultima
      ? {
          id: ultima.id,
          folio: ultima.name,
          fecha: ultima.invoice_date || null,
          monto: redondear(astaDe.get(ultima.id) ?? 0),
          estadoPago: ultima.payment_state || null,
        }
      : null,
  };

  if (query.incluirSerieMensual) {
    summary.serieMensual = [...porMes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, m]) => ({ periodo: etiquetaMes(m.inicio), monto: redondear(m.monto), facturas: m.facturas }));
  }

  return summary;
}
