import { readGroup, searchRead } from '../odoo/client.js';
import { productosEnCompetencia } from './asta.service.js';
import { FACTURA, NOTA_DE_CREDITO } from './criterioFacturacion.js';
import { carteraDe, mesDelGrupo, mesesDe, totalDeProductos, type RangoFechas, type Reporte } from './reportes.service.js';
import { compras, enRango as enRangoSb, smartbit, type VentaSmartbit } from './smartbit.service.js';
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
 *
 * Con las ventas de Smartbit (`smartbit.service`), lo de antes del
 * 1-abr-2026: suman a lo facturado, la serie, los clientes y las facturas
 * (cada cliente en un día es una compra), no a «por cobrar». En la vista del
 * vendedor, las que hizo él; en `porVendedor`, cada una con quien la hizo.
 * La cuota sigue siendo solo de Odoo: Smartbit trae ASTA, no la competencia, y
 * mezclarlas la inflaría.
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

  const [lineasPorMes, lineasPorCliente, facturasPorMes, facturasPorCliente, competencia, sb] = await Promise.all([
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
    smartbit(),
  ]);
  const ventasSb = sb.ventas.filter((v) => enRangoSb(v, rango) && (deLaEmpresa || v.vendedorId === odooUserId));

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
  for (const v of ventasSb) monto.set(v.fecha.slice(0, 7), (monto.get(v.fecha.slice(0, 7)) ?? 0) + v.venta);
  const comprasSb = compras(ventasSb);
  for (const c of comprasSb) {
    facturas++;
    nFacturas.set(c.fecha.slice(0, 7), (nFacturas.get(c.fecha.slice(0, 7)) ?? 0) + 1);
  }

  const facturasDe = new Map<number, number>();
  const saldoDe = new Map<number, number>();
  for (const g of facturasPorCliente) {
    if (!g.commercial_partner_id) continue;
    const id = g.commercial_partner_id[0];
    saldoDe.set(id, (saldoDe.get(id) ?? 0) + (g.amount_residual_signed ?? 0));
    if (g.move_type === FACTURA) facturasDe.set(id, (facturasDe.get(id) ?? 0) + g.__count);
  }

  // Por cliente: los de Odoo por su id; los de Smartbit, por el cliente de
  // Odoo con su RIF, o por el RIF si no está en Odoo.
  const porCliente = new Map<string, { partnerId: number | null; nombre: string; facturado: number; facturas: number }>();
  for (const g of lineasPorCliente) {
    if (!g.partner_id) continue;
    const [id, nombre] = g.partner_id;
    porCliente.set(`p${id}`, { partnerId: id, nombre: nombre.trim(), facturado: -g.balance, facturas: facturasDe.get(id) ?? 0 });
  }
  const claveCliente = (v: VentaSmartbit) => (v.partnerId ? `p${v.partnerId}` : `r${v.rif ?? v.cliente}`);
  const filaSb = (v: VentaSmartbit) => {
    const clave = claveCliente(v);
    const f = porCliente.get(clave) ?? { partnerId: v.partnerId, nombre: v.cliente, facturado: 0, facturas: 0 };
    porCliente.set(clave, f);
    return f;
  };
  for (const v of ventasSb) filaSb(v).facturado += v.venta;
  for (const c of comprasSb) filaSb(c).facturas++;

  const clientes = [...porCliente.values()].map((c) => ({ ...c, facturado: redondear(c.facturado) }));
  const conCompra = new Set([...[...facturasDe.keys()].map((id) => `p${id}`), ...comprasSb.map(claveCliente)]);

  const facturado = clientes.reduce((s, c) => s + c.facturado, 0);
  // La cuota, solo con Odoo (ver arriba).
  const asta = lineasPorCliente.reduce((s, g) => s - g.balance, 0);
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
      clientes: conCompra.size,
    },
    serieMensual: mesesDe(rango).map((periodo) => ({
      periodo,
      monto: redondear(monto.get(periodo) ?? 0),
      facturas: nFacturas.get(periodo) ?? 0,
    })),
    topClientes: [...clientes].sort((a, b) => b.facturado - a.facturado).slice(0, 15),
    porVendedor: deLaEmpresa ? await porVendedorDeLaEmpresa(lineasPorCliente, facturasDe, saldoDe, ventasSb, comprasSb) : null,
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
 * Por vendedor. Lo de Odoo, por el comercial ASIGNADO al cliente (una lectura
 * de `res.partner` con los que compraron ASTA en el periodo); lo de Smartbit,
 * por el vendedor que hizo la venta. Los de Smartbit sin usuario en Odoo salen
 * cada uno con su nombre, sin id.
 */
async function porVendedorDeLaEmpresa(
  lineasPorCliente: Array<{ partner_id: [number, string] | false; balance: number }>,
  facturasDe: Map<number, number>,
  saldoDe: Map<number, number>,
  ventasSb: VentaSmartbit[],
  comprasSb: VentaSmartbit[],
): Promise<NonNullable<Reporte['porVendedor']>> {
  const ids = [...new Set([...lineasPorCliente.flatMap((g) => (g.partner_id ? [g.partner_id[0]] : [])), ...saldoDe.keys()])];
  // Los archivados también: compraron en el periodo, y su venta tiene que estar.
  const partners = ids.length
    ? await searchRead<{ id: number; user_id: [number, string] | false }>('res.partner', [['id', 'in', ids]], ['user_id'], { context: { active_test: false } })
    : [];
  const comercial = new Map(partners.map((p) => [p.id, p.user_id || null]));

  const filas = new Map<string, { odooUserId: number | null; nombre: string; facturado: number; porCobrar: number; facturas: number }>();
  const fila = (odooUserId: number | null, nombre: string) => {
    const clave = odooUserId ? `u${odooUserId}` : `n${nombre}`;
    const f = filas.get(clave) ?? { odooUserId, nombre, facturado: 0, porCobrar: 0, facturas: 0 };
    filas.set(clave, f);
    return f;
  };
  const deCliente = (id: number) => {
    const u = comercial.get(id) ?? null;
    return u ? fila(u[0], u[1].trim()) : fila(null, 'Sin comercial asignado');
  };
  for (const g of lineasPorCliente) if (g.partner_id) deCliente(g.partner_id[0]).facturado -= g.balance;
  for (const [id, saldo] of saldoDe) deCliente(id).porCobrar += saldo;
  for (const [id, n] of facturasDe) deCliente(id).facturas += n;

  const deVendedor = (v: VentaSmartbit) => fila(v.vendedorId, v.vendedor || 'Sin vendedor');
  for (const v of ventasSb) deVendedor(v).facturado += v.venta;
  for (const c of comprasSb) deVendedor(c).facturas++;

  // Un vendedor con fila de Odoo y de Smartbit es una sola: el nombre, el de Odoo.
  return [...filas.values()]
    .map((f) => ({ ...f, facturado: redondear(f.facturado), porCobrar: redondear(f.porCobrar) }))
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
