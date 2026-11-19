import { describe, expect, it } from 'vitest';
import { searchRead } from '../odoo/client.js';
import { enPeriodoDeLaFactura } from '../services/criterioFacturacion.js';
import { LINEAS_ASTA } from '../services/ventasAsta.service.js';

/*
 * Contra Odoo: una nota de crédito ASTA que corrige una factura de OTRO mes
 * cuenta en el mes de la factura, no en el suyo. Así la compra mensual del
 * Programa ASTA (y el ritmo del mes) no sale en negativo en un mes sin compras.
 */

const finDeMes = (f: string) => {
  const [a, m] = f.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

describe('Nota de crédito de un mes anterior', () => {
  it('resta en el mes de la factura que corrige, no en el suyo', async (ctx) => {
    const notas = await searchRead<{ move_id: [number, string]; invoice_date: string }>(
      'account.move.line',
      [...LINEAS_ASTA, ['move_id.move_type', '=', 'out_refund'], ['move_id.reversed_entry_id', '!=', false], ['invoice_date', '>=', '2026-01-01']],
      ['move_id', 'invoice_date'],
      { limit: 200, order: 'invoice_date desc' },
    );
    let caso: { linea: number; fechaNota: string; fechaFactura: string } | null = null;
    for (const n of notas) {
      const [m] = await searchRead<{ reversed_entry_id: [number, string] | false }>('account.move', [['id', '=', n.move_id[0]]], ['reversed_entry_id']);
      if (!m?.reversed_entry_id) continue;
      const [f] = await searchRead<{ invoice_date: string }>('account.move', [['id', '=', m.reversed_entry_id[0]]], ['invoice_date']);
      if (f && f.invoice_date.slice(0, 7) !== n.invoice_date.slice(0, 7)) {
        const [l] = await searchRead<{ id: number }>('account.move.line', [...LINEAS_ASTA, ['move_id', '=', n.move_id[0]]], ['id'], { limit: 1 });
        caso = { linea: l!.id, fechaNota: n.invoice_date, fechaFactura: f.invoice_date };
        break;
      }
    }
    if (!caso) return ctx.skip();

    const en = async (fecha: string) =>
      (await searchRead<{ id: number }>('account.move.line', [['id', '=', caso!.linea], ...enPeriodoDeLaFactura(`${fecha.slice(0, 7)}-01`, finDeMes(fecha))], ['id'])).length;
    expect(await en(caso.fechaFactura)).toBe(1);
    expect(await en(caso.fechaNota)).toBe(0);
  });
});
