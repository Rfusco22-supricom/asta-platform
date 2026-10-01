import { describe, expect, it } from 'vitest';
import { TIPO_FACTURADO, TIPO_FACTURADO_LINEA, plegarPorTipo } from '../services/criterioFacturacion.js';

/*
 * #26 · «Total facturado» es neto de devoluciones, en todo el panel.
 *
 * Las cifras de los casos son las de un cliente real medido con
 * `verify:invoicing`: 181 facturas por 112.297,32 y dos notas de crédito por
 * 540,91.
 */

describe('#26 · Qué entra en el total', () => {
  it('facturas y notas de crédito, en cabecera y en líneas', () => {
    expect(TIPO_FACTURADO).toEqual(['move_type', 'in', ['out_invoice', 'out_refund']]);
    expect(TIPO_FACTURADO_LINEA).toEqual(['move_id.move_type', 'in', ['out_invoice', 'out_refund']]);
  });
});

describe('#26 · Cabecera: los `*_signed` ya vienen firmados', () => {
  const grupos = [
    { cliente: 7, move_type: 'out_invoice', amount_total_signed: 112_297.32, __count: 181 },
    { cliente: 7, move_type: 'out_refund', amount_total_signed: -540.91, __count: 2 },
  ];

  it('se suman tal cual: la nota de crédito resta porque ya es negativa', () => {
    const r = plegarPorTipo(grupos, (g) => g.cliente, ['amount_total_signed']).get(7);
    expect(r?.sumas.amount_total_signed).toBeCloseTo(111_756.41, 2);
  });

  it('cuenta facturas, no documentos: las dos notas no suman una factura', () => {
    expect(plegarPorTipo(grupos, (g) => g.cliente, ['amount_total_signed']).get(7)?.facturas).toBe(181);
  });
});

describe('#26 · Líneas: importe y cantidad vienen en positivo', () => {
  // Así los devuelve Odoo: la devolución de 3 unidades por 90 es +3 y +90.
  const lineas = [
    { producto: 1, move_type: 'out_invoice', price_subtotal: 1000, quantity: 10, __count: 4 },
    { producto: 1, move_type: 'out_refund', price_subtotal: 90, quantity: 3, __count: 1 },
  ];

  it('con `firmar`, la devolución resta importe y cantidad', () => {
    const r = plegarPorTipo(lineas, (g) => g.producto, ['price_subtotal', 'quantity'], { firmar: true }).get(1);
    expect(r?.sumas).toEqual({ price_subtotal: 910, quantity: 7 });
  });

  it('sin `firmar` la sumaría: por eso las líneas lo necesitan y la cabecera no', () => {
    const r = plegarPorTipo(lineas, (g) => g.producto, ['price_subtotal']).get(1);
    expect(r?.sumas.price_subtotal).toBe(1090);
  });
});

describe('#26 · Plegado', () => {
  it('descarta los grupos sin clave', () => {
    const r = plegarPorTipo(
      [{ id: null as number | null, move_type: 'out_invoice', amount_total_signed: 5, __count: 1 }],
      (g) => g.id,
      ['amount_total_signed'],
    );
    expect(r.size).toBe(0);
  });

  it('un cliente con solo devoluciones queda en negativo y con 0 facturas', () => {
    const r = plegarPorTipo(
      [{ id: 9, move_type: 'out_refund', amount_total_signed: -50, __count: 1 }],
      (g) => g.id,
      ['amount_total_signed'],
    ).get(9);
    expect(r).toEqual({ sumas: { amount_total_signed: -50 }, facturas: 0 });
  });
});
