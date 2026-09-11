import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';

/**
 * Facturación de un cliente, leída en vivo de `account.move`.
 *
 * Notas de modelado que importan para que el número salga bien:
 *
 * 1. `child_of` en vez de `=`. Un cliente corporativo tiene contactos y sucursales
 *    hijas en res.partner, y las facturas pueden estar emitidas contra cualquiera
 *    de ellos. Con `=` los totales salen por debajo del real.
 *
 * 2. `amount_total_signed` en vez de `amount_total`. El primero está expresado en
 *    la moneda de la compañía (si facturas en USD y MXN, `amount_total` suma peras
 *    con manzanas) y viene firmado, de modo que las notas de crédito restan.
 *
 * 3. `read_group` en vez de traer las facturas y sumarlas en Node. La agregación
 *    ocurre en Postgres: vuelve un puñado de filas en lugar de 10.000 facturas.
 *
 * 4. `state = 'posted'`. Los borradores no son facturación, y `cancel` tampoco.
 */

/** Estados de conciliación de pago que expone Odoo 16+. */
type PaymentState = 'not_paid' | 'in_payment' | 'paid' | 'partial' | 'reversed' | 'invoicing_legacy';

interface PaymentStateGroup {
  payment_state: PaymentState | false;
  amount_total_signed: number;
  amount_residual_signed: number;
  __count: number;
}

interface MonthlyGroup {
  'invoice_date:month': string | false; // "enero 2026"
  __range?: Record<string, { from: string; to: string }>;
  amount_total_signed: number;
  __count: number;
}

interface LastInvoiceRow {
  id: number;
  name: string;
  invoice_date: string | false;
  amount_total_signed: number;
  payment_state: PaymentState | false;
}

export interface InvoicingSummary {
  partnerId: number;
  currency: string;
  /** Suma de todo lo facturado y contabilizado. */
  totalFacturado: number;
  /** Saldo pendiente de cobro (amount_residual). */
  porCobrar: number;
  /** totalFacturado - porCobrar. */
  cobrado: number;
  numeroFacturas: number;
  ticketPromedio: number;
  desglosePorEstadoDePago: Array<{
    estado: PaymentState | 'desconocido';
    monto: number;
    saldo: number;
    facturas: number;
  }>;
  ultimaFactura: {
    id: number;
    folio: string;
    fecha: string | null;
    monto: number;
    estadoPago: PaymentState | null;
  } | null;
  serieMensual?: Array<{ periodo: string; monto: number; facturas: number }>;
}

export interface InvoicingQuery {
  /** Fecha de factura desde (YYYY-MM-DD), inclusiva. */
  desde?: string;
  /** Fecha de factura hasta (YYYY-MM-DD), inclusiva. */
  hasta?: string;
  /**
   * Incluir notas de crédito (`out_refund`), que restan del total.
   *
   * Por defecto `false`, que es la definición literal de "total facturado" pedida
   * en la especificación. Ojo: con clientes que devuelven mercancía, el número
   * *neto* real es el de `true`. Conviene decidirlo con el área comercial y dejar
   * un solo criterio en todo el panel.
   */
  incluirNotasDeCredito?: boolean;
  /** Devuelve además la serie mensual, para graficar la evolución. */
  incluirSerieMensual?: boolean;
}

function buildDomain(partnerId: number, query: InvoicingQuery): OdooDomain {
  const moveTypes = query.incluirNotasDeCredito ? ['out_invoice', 'out_refund'] : ['out_invoice'];

  const domain: OdooDomain = [
    ['partner_id', 'child_of', partnerId],
    ['move_type', 'in', moveTypes],
    ['state', '=', 'posted'],
  ];

  if (query.desde) domain.push(['invoice_date', '>=', query.desde]);
  if (query.hasta) domain.push(['invoice_date', '<=', query.hasta]);

  return domain;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Devuelve el resumen de facturación de un cliente.
 *
 * Cuesta 2 RPC (3 si se pide la serie mensual), independientemente de cuántas
 * facturas tenga el cliente.
 */
export async function getPartnerInvoicingSummary(
  partnerId: number,
  query: InvoicingQuery = {},
): Promise<InvoicingSummary> {
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new TypeError(`partnerId inválido: ${partnerId}`);
  }

  const domain = buildDomain(partnerId, query);

  const [groups, lastInvoices] = await Promise.all([
    readGroup<PaymentStateGroup>(
      'account.move',
      domain,
      ['amount_total_signed:sum', 'amount_residual_signed:sum'],
      ['payment_state'],
    ),
    searchRead<LastInvoiceRow>(
      'account.move',
      domain,
      ['id', 'name', 'invoice_date', 'amount_total_signed', 'payment_state'],
      { limit: 1, order: 'invoice_date desc, id desc' },
    ),
  ]);

  let totalFacturado = 0;
  let porCobrar = 0;
  let numeroFacturas = 0;

  const desglosePorEstadoDePago = groups.map((group) => {
    const monto = group.amount_total_signed ?? 0;
    const saldo = group.amount_residual_signed ?? 0;

    totalFacturado += monto;
    porCobrar += saldo;
    numeroFacturas += group.__count;

    return {
      estado: (group.payment_state || 'desconocido') as PaymentState | 'desconocido',
      monto: round2(monto),
      saldo: round2(saldo),
      facturas: group.__count,
    };
  });

  const summary: InvoicingSummary = {
    partnerId,
    currency: 'company', // moneda de la compañía; ver amount_total_signed
    totalFacturado: round2(totalFacturado),
    porCobrar: round2(porCobrar),
    cobrado: round2(totalFacturado - porCobrar),
    numeroFacturas,
    ticketPromedio: numeroFacturas > 0 ? round2(totalFacturado / numeroFacturas) : 0,
    desglosePorEstadoDePago,
    ultimaFactura: lastInvoices[0]
      ? {
          id: lastInvoices[0].id,
          folio: lastInvoices[0].name,
          fecha: lastInvoices[0].invoice_date || null,
          monto: round2(lastInvoices[0].amount_total_signed ?? 0),
          estadoPago: lastInvoices[0].payment_state || null,
        }
      : null,
  };

  if (query.incluirSerieMensual) {
    const monthly = await readGroup<MonthlyGroup>(
      'account.move',
      domain,
      ['amount_total_signed:sum'],
      ['invoice_date:month'],
    );

    summary.serieMensual = monthly
      .filter((row) => row['invoice_date:month'])
      .map((row) => ({
        periodo: String(row['invoice_date:month']),
        monto: round2(row.amount_total_signed ?? 0),
        facturas: row.__count,
      }));
  }

  return summary;
}

/**
 * Versión en lote para el dashboard del vendedor: un solo RPC devuelve el total
 * de TODOS sus clientes.
 *
 * Sin esto, un vendedor con 80 clientes dispara 80 llamadas a Odoo al cargar su
 * pantalla — el N+1 clásico, pero contra el ERP, que es donde más duele.
 */
export async function getInvoicingTotalsByPartner(
  partnerIds: number[],
  query: InvoicingQuery = {},
): Promise<Map<number, { total: number; porCobrar: number; facturas: number }>> {
  const result = new Map<number, { total: number; porCobrar: number; facturas: number }>();
  if (partnerIds.length === 0) return result;

  const moveTypes = query.incluirNotasDeCredito ? ['out_invoice', 'out_refund'] : ['out_invoice'];

  /**
   * `commercial_partner_id in [...]` en vez de `partner_id child_of [...]`.
   *
   * Son equivalentes aquí —la cartera son partners de primer nivel, y
   * `commercial_partner_id` de cualquier sucursal apunta a su matriz— pero
   * `child_of` obliga a Odoo a expandir el árbol de cada uno de los cientos de
   * IDs antes de filtrar. Con una cartera de 791 clientes eso costaba ~2,9 s.
   *
   * Ojo: esto vale porque además se agrupa por `commercial_partner_id`. Para un
   * cliente suelto, `getPartnerInvoicingSummary` sigue usando `child_of`, que es
   * lo correcto cuando el id recibido puede ser una sucursal.
   */
  const domain: OdooDomain = [
    ['commercial_partner_id', 'in', partnerIds],
    ['move_type', 'in', moveTypes],
    ['state', '=', 'posted'],
  ];
  if (query.desde) domain.push(['invoice_date', '>=', query.desde]);
  if (query.hasta) domain.push(['invoice_date', '<=', query.hasta]);

  // Agrupado por commercial_partner_id: consolida cada sucursal bajo su matriz,
  // que es la entidad que el vendedor ve en su cartera.
  const groups = await readGroup<{
    commercial_partner_id: [number, string] | false;
    amount_total_signed: number;
    amount_residual_signed: number;
    __count: number;
  }>(
    'account.move',
    domain,
    ['amount_total_signed:sum', 'amount_residual_signed:sum'],
    ['commercial_partner_id'],
  );

  for (const group of groups) {
    if (!group.commercial_partner_id) continue;
    const [id] = group.commercial_partner_id;
    result.set(id, {
      total: round2(group.amount_total_signed ?? 0),
      porCobrar: round2(group.amount_residual_signed ?? 0),
      facturas: group.__count,
    });
  }

  // Los clientes sin una sola factura no aparecen en read_group: se rellenan en
  // cero para que la tabla del panel no tenga huecos.
  for (const partnerId of partnerIds) {
    if (!result.has(partnerId)) {
      result.set(partnerId, { total: 0, porCobrar: 0, facturas: 0 });
    }
  }

  return result;
}
