import { beforeAll, describe, expect, it } from 'vitest';
import { readGroup, searchRead } from '../odoo/client.js';
import { idsDeCartera } from '../services/partners.service.js';
import { LINEAS_ASTA, resumenAstaDeCliente, totalesAstaDeCartera } from '../services/ventasAsta.service.js';
import { reporteAstaDeLaEmpresa, reporteAstaDelVendedor } from '../services/reporteAsta.service.js';

/**
 * El panel del vendedor cuenta solo ASTA (`ventasAsta.service`).
 *
 * Contra la instancia, solo lectura: lo que se le enseña a un vendedor es de su
 * cartera y de nadie más, el filtro rápido por comercial suma lo mismo que la
 * lista de la cartera, y la tabla de «Mi cartera» y la ficha del cliente dicen
 * lo mismo de un mismo cliente.
 */

let A = 0;
let B = 0;

beforeAll(async () => {
  const partners = await searchRead<{ user_id: [number, string] | false }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['user_id', '!=', false],
      ['parent_id', '=', false],
      ['active', '=', true],
    ],
    ['user_id'],
  );
  const cuenta = new Map<number, number>();
  for (const p of partners) if (p.user_id) cuenta.set(p.user_id[0], (cuenta.get(p.user_id[0]) ?? 0) + 1);
  // Los dos de cartera más pequeña con al menos treinta clientes: así es
  // probable que alguno compre ASTA y el test no espera.
  const conCartera = [...cuenta.entries()].filter(([, n]) => n >= 30).sort((a, b) => a[1] - b[1]).map(([uid]) => uid);
  if (conCartera.length < 2) throw new Error('Hacen falta dos vendedores con cartera.');
  [A, B] = conCartera;
});

describe('ventas ASTA · cada vendedor ve solo su cartera', () => {
  it('todos los clientes con ASTA son de su cartera', async () => {
    const [t, ids] = await Promise.all([totalesAstaDeCartera(A), idsDeCartera(A)]);
    const deLaCartera = new Set(ids);
    expect([...t.keys()].filter((id) => !deLaCartera.has(id))).toEqual([]);
  });

  it('A y B no comparten ningún cliente', async () => {
    const [ta, tb] = await Promise.all([totalesAstaDeCartera(A), totalesAstaDeCartera(B)]);
    expect([...tb.keys()].filter((id) => ta.has(id))).toEqual([]);
  });

  it('el filtro por comercial suma lo mismo que la lista de la cartera', async () => {
    const [t, ids] = await Promise.all([totalesAstaDeCartera(A), idsDeCartera(A)]);
    const conLista = await readGroup<{ balance: number }>('account.move.line', [...LINEAS_ASTA, ['partner_id', 'in', ids]], ['balance:sum'], []);
    const total = [...t.values()].reduce((s, x) => s + x.total, 0);
    expect(total).toBeCloseTo(-(conLista[0]?.balance ?? 0), 0);
  });

  it('solo cuenta ASTA: lo de ASTA nunca pasa de lo facturado entero', async () => {
    const t = await totalesAstaDeCartera(A);
    const ids = [...t.keys()];
    if (ids.length === 0) return;
    const enteras = await readGroup<{ commercial_partner_id: [number, string]; amount_untaxed_signed: number }>(
      'account.move',
      [['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']], ['commercial_partner_id', 'in', ids]],
      ['amount_untaxed_signed:sum'],
      ['commercial_partner_id'],
    );
    const entero = new Map(enteras.map((g) => [g.commercial_partner_id[0], g.amount_untaxed_signed]));
    // Con un margen de céntimos por redondeo; si lo ASTA pasara de la factura
    // entera, se estaría contando algo que no es ASTA.
    expect(ids.filter((id) => (t.get(id)?.total ?? 0) > (entero.get(id) ?? 0) + 0.05)).toEqual([]);
  });
});

describe('ventas ASTA · la cartera y la ficha dicen lo mismo', () => {
  it('el cliente que más compra ASTA: mismo total, mismas facturas y mismo saldo', async () => {
    // Como la pide «Mi cartera»: con la historia de Smartbit de sus clientes.
    const t = await totalesAstaDeCartera(A, {}, await idsDeCartera(A));
    const [primero] = [...t].sort((x, y) => y[1].total - x[1].total);
    if (!primero) return;
    const [partnerId, enCartera] = primero;
    const ficha = await resumenAstaDeCliente(partnerId);
    expect(ficha.totalFacturado).toBeCloseTo(enCartera.total, 1);
    expect(ficha.numeroFacturas).toBe(enCartera.facturas);
    expect(ficha.porCobrar).toBeCloseTo(enCartera.porCobrar, 1);
    // `ultimaFactura` es una factura de Odoo: con la historia de Smartbit, el
    // que más compra puede no tener ninguna.
    expect(ficha.numeroFacturas).toBeGreaterThan(0);
  });
});

describe('ventas ASTA · la empresa es la suma de las carteras', () => {
  const RANGO = { desde: '2026-07-01', hasta: '2026-09-30' };

  it('lo de un vendedor en la vista de empresa es lo mismo que en su cartera', async () => {
    const [empresa, deA] = await Promise.all([totalesAstaDeCartera(null), totalesAstaDeCartera(A)]);
    for (const [id, t] of deA) expect(empresa.get(id)?.total, `cliente ${id}`).toBeCloseTo(t.total, 1);
  });

  it('el reporte de la empresa: «por vendedor» suma el total, y la fila de A es su reporte', async () => {
    const [empresa, deA] = await Promise.all([reporteAstaDeLaEmpresa(RANGO), reporteAstaDelVendedor(A, RANGO)]);
    const filas = empresa.porVendedor ?? [];
    expect(filas.reduce((s, f) => s + f.facturado, 0)).toBeCloseTo(empresa.totales.facturado, 0);
    expect(filas.reduce((s, f) => s + f.facturas, 0)).toBe(empresa.totales.facturas);
    const filaA = filas.find((f) => f.odooUserId === A);
    expect(filaA?.facturado ?? 0).toBeCloseTo(deA.totales.facturado, 0);
    expect(deA.porVendedor).toBeNull();
  }, 120_000);
});
