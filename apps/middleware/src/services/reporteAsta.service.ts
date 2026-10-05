import { readGroup } from '../odoo/client.js';
import { productosEnCompetencia } from './asta.service.js';
import { FACTURA, NOTA_DE_CREDITO } from './criterioFacturacion.js';
import { carteraDe, mesDelGrupo, mesesDe, totalDeProductos, type RangoFechas, type Reporte } from './reportes.service.js';
import { FACTURA_CON_ASTA, LINEAS_ASTA, carteraDesdeFactura, carteraDesdeLinea } from './ventasAsta.service.js';

/**
 * El reporte de la cartera de un vendedor, SOLO ASTA (ver `ventasAsta.service`).
 *
 * Misma forma que `reporte()` para que la pantalla no cambie de contrato, con
 * otro significado en cada cifra:
 *
 *   · `facturado`, la serie y el top de clientes: lo vendido de ASTA, sin IVA,
 *     neto de devoluciones;
 *   · `facturas`: facturas de venta que llevan ASTA;
 *   · `porCobrar`: el saldo de esas facturas;
 *   · `asta`: la cuota frente a la competencia, que sigue mirando las otras
 *     marcas porque es la oportunidad (decisión del 5-oct-2026).
 *
 * El reporte de administración (`reporte()` sin vendedor) no cambia.
 */
export async function reporteAstaDelVendedor(odooUserId: number, rango: RangoFechas): Promise<Reporte> {
  const t0 = Date.now();
  const enRango = [
    ['invoice_date', '>=', rango.desde],
    ['invoice_date', '<=', rango.hasta],
  ] as const;
  const lineas = [...LINEAS_ASTA, ...carteraDesdeLinea(odooUserId), ...enRango];
  const facturasAsta = [
    ['state', '=', 'posted'],
    ['move_type', 'in', [FACTURA, NOTA_DE_CREDITO]],
    FACTURA_CON_ASTA,
    ...carteraDesdeFactura(odooUserId),
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
    readGroup<{ commercial_partner_id: [number, string] | false; move_type: string | false; __count: number }>(
      'account.move',
      facturasAsta as never,
      [],
      ['commercial_partner_id', 'move_type'],
    ),
    // La competencia, como oportunidad: lo que la cartera compró de otras
    // marcas en las categorías donde ASTA tiene producto.
    (async () => totalDeProductos((await productosEnCompetencia()).otros, rango, await carteraDe(odooUserId)))(),
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
  for (const g of facturasPorCliente) {
    if (g.commercial_partner_id && g.move_type === FACTURA) facturasDe.set(g.commercial_partner_id[0], (facturasDe.get(g.commercial_partner_id[0]) ?? 0) + g.__count);
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
    topClientes: clientes.sort((a, b) => b.facturado - a.facturado).slice(0, 15),
    porVendedor: null,
    asta: {
      asta: redondear(asta),
      competencia: redondear(competencia),
      cuota: consumibles > 0 ? Math.round((asta / consumibles) * 1000) / 10 : 0,
    },
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
