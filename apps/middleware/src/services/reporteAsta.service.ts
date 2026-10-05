import { readGroup, searchRead } from '../odoo/client.js';
import { productosEnCompetencia } from './asta.service.js';
import { FACTURA, NOTA_DE_CREDITO } from './criterioFacturacion.js';
import { carteraDe, mesDelGrupo, mesesDe, totalDeProductos, type RangoFechas, type Reporte } from './reportes.service.js';
import { FACTURA_CON_ASTA, LINEAS_ASTA, carteraDesdeFactura, carteraDesdeLinea } from './ventasAsta.service.js';

/**
 * El reporte SOLO ASTA (ver `ventasAsta.service`), de la cartera de un vendedor
 * o de toda la empresa.
 *
 * Misma forma que `reporte()` para que la pantalla no cambie de contrato, con
 * otro significado en cada cifra:
 *
 *   · `facturado`, la serie y el top de clientes: lo vendido de ASTA, sin IVA,
 *     neto de devoluciones;
 *   · `facturas`: facturas de venta que llevan ASTA;
 *   · `porCobrar`: el saldo de esas facturas;
 *   · `porVendedor` (solo empresa): por el comercial ASIGNADO al cliente, el
 *     mismo criterio que «Mi cartera», así que la fila de cada vendedor es su
 *     cartera. Antes era el comercial de la factura (`invoice_user_id`);
 *   · `asta`: la cuota frente a la competencia, que sigue mirando las otras
 *     marcas porque es la oportunidad (decisión del 5-oct-2026).
 */
async function reporteAsta(odooUserId: number | null, rango: RangoFechas): Promise<Reporte> {
  const t0 = Date.now();
  const deLaEmpresa = odooUserId === null;
  const enRango = [
    ['invoice_date', '>=', rango.desde],
    ['invoice_date', '<=', rango.hasta],
  ] as const;
  const lineas = [...LINEAS_ASTA, ...(deLaEmpresa ? [] : carteraDesdeLinea(odooUserId)), ...enRango];
  const facturasAsta = [
    ['state', '=', 'posted'],
    ['move_type', 'in', [FACTURA, NOTA_DE_CREDITO]],
    FACTURA_CON_ASTA,
    ...(deLaEmpresa ? [] : carteraDesdeFactura(odooUserId)),
    ...enRango,
  ];

  const [lineasPorMes, lineasPorCliente, facturasPorMes, facturasPorCliente, competencia] = await Promise.all([
    readGroup<{ balance: number; __domain?: unknown }>('account.move.line', lineas as never, ['balance:sum'], ['invoice_date:month']),
    readGroup<{ partner_id: [number, string] | false; balance: number }>('account.move.line', lineas as never, ['balance:sum'], ['partner_id']),
    readGroup<{ move_type: string | false; amount_residual_signed: number; __count: number; __domain?: unknown }>(
      'account.move',
      facturasAsta as never,
      ['amount_residual_signed:sum'],
      ['invoice_date:month', 'move_type'],
    ),
    readGroup<{ commercial_partner_id: [number, string] | false; move_type: string | false; amount_residual_signed: number; __count: number }>(
      'account.move',
      facturasAsta as never,
      ['amount_residual_signed:sum'],
      ['commercial_partner_id', 'move_type'],
    ),
    // La competencia, como oportunidad: lo que se compró de otras marcas en las
    // categorías donde ASTA tiene producto.
    (async () => totalDeProductos((await productosEnCompetencia()).otros, rango, deLaEmpresa ? null : await carteraDe(odooUserId)))(),
  ]);

  const monto = new Map<string, number>();
  for (const g of lineasPorMes) {
    const mes = mesDelGrupo(g);
    if (mes) monto.set(mes, (monto.get(mes) ?? 0) - g.balance);
  }
  const nFacturas = new Map<string, number>();
  let porCobrar = 0;
  let facturas = 0;
  for (const g of facturasPorMes) {
    porCobrar += g.amount_residual_signed ?? 0;
    if (g.move_type !== FACTURA) continue;
    facturas += g.__count;
    const mes = mesDelGrupo(g);
    if (mes) nFacturas.set(mes, (nFacturas.get(mes) ?? 0) + g.__count);
  }

  const facturasDe = new Map<number, number>();
  const saldoDe = new Map<number, number>();
  for (const g of facturasPorCliente) {
    if (!g.commercial_partner_id) continue;
    const id = g.commercial_partner_id[0];
    saldoDe.set(id, (saldoDe.get(id) ?? 0) + (g.amount_residual_signed ?? 0));
    if (g.move_type === FACTURA) facturasDe.set(id, (facturasDe.get(id) ?? 0) + g.__count);
  }

  const clientes = lineasPorCliente
    .filter((g) => g.partner_id)
    .map((g) => ({
      partnerId: (g.partner_id as [number, string])[0],
      nombre: (g.partner_id as [number, string])[1].trim(),
      facturado: redondear(-g.balance),
      facturas: facturasDe.get((g.partner_id as [number, string])[0]) ?? 0,
    }));

  const facturado = clientes.reduce((s, c) => s + c.facturado, 0);
  const asta = facturado;
  const consumibles = asta + competencia;

  return {
    periodo: { desde: rango.desde, hasta: rango.hasta },
    criterio: { incluyeNotasDeCredito: true, soloContabilizadas: true },
    totales: {
      facturado: redondear(facturado),
      porCobrar: redondear(porCobrar),
      facturas,
      ticketPromedio: facturas > 0 ? redondear(facturado / facturas) : 0,
      // Clientes con al menos una factura con ASTA en el periodo.
      clientes: facturasDe.size,
    },
    serieMensual: mesesDe(rango).map((periodo) => ({
      periodo,
      monto: redondear(monto.get(periodo) ?? 0),
      facturas: nFacturas.get(periodo) ?? 0,
    })),
    topClientes: [...clientes].sort((a, b) => b.facturado - a.facturado).slice(0, 15),
    porVendedor: deLaEmpresa ? await porComercialAsignado(clientes, facturasDe, saldoDe) : null,
    asta: {
      asta: redondear(asta),
      competencia: redondear(competencia),
      cuota: consumibles > 0 ? Math.round((asta / consumibles) * 1000) / 10 : 0,
    },
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };
}

/**
 * Por vendedor: cada cliente, con su comercial asignado en Odoo. Una lectura
 * de `res.partner` con los clientes que compraron ASTA en el periodo.
 */
async function porComercialAsignado(
  clientes: Array<{ partnerId: number; facturado: number }>,
  facturasDe: Map<number, number>,
  saldoDe: Map<number, number>,
): Promise<NonNullable<Reporte['porVendedor']>> {
  const ids = [...new Set([...clientes.map((c) => c.partnerId), ...saldoDe.keys()])];
  // Los archivados también: compraron en el periodo, y su venta tiene que estar.
  const partners = ids.length
    ? await searchRead<{ id: number; user_id: [number, string] | false }>('res.partner', [['id', 'in', ids]], ['user_id'], { context: { active_test: false } })
    : [];
  const comercial = new Map(partners.map((p) => [p.id, p.user_id || null]));

  const filas = new Map<number, { nombre: string; facturado: number; porCobrar: number; facturas: number }>();
  const fila = (id: number) => {
    const u = comercial.get(id) ?? null;
    const clave = u ? u[0] : 0;
    const f = filas.get(clave) ?? { nombre: u ? u[1].trim() : 'Sin comercial asignado', facturado: 0, porCobrar: 0, facturas: 0 };
    filas.set(clave, f);
    return f;
  };
  for (const c of clientes) fila(c.partnerId).facturado += c.facturado;
  for (const [id, saldo] of saldoDe) fila(id).porCobrar += saldo;
  for (const [id, n] of facturasDe) fila(id).facturas += n;

  return [...filas]
    .map(([uid, f]) => ({
      odooUserId: uid === 0 ? null : uid,
      nombre: f.nombre,
      facturado: redondear(f.facturado),
      porCobrar: redondear(f.porCobrar),
      facturas: f.facturas,
    }))
    .sort((a, b) => b.facturado - a.facturado);
}

/** El reporte de la cartera de un vendedor, solo ASTA. */
export function reporteAstaDelVendedor(odooUserId: number, rango: RangoFechas): Promise<Reporte> {
  return reporteAsta(odooUserId, rango);
}

/** El reporte de toda la empresa, solo ASTA: la vista de administración. */
export function reporteAstaDeLaEmpresa(rango: RangoFechas): Promise<Reporte> {
  return reporteAsta(null, rango);
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
