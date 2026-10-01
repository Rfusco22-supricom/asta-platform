import { describe, expect, it } from 'vitest';

/**
 * #13 · El cliente XML-RPC contra Odoo de verdad.
 *
 * Lo que los mocks no capturan y el código da por hecho. Si una actualización de
 * Odoo cambiara alguna de estas costumbres, aquí saldría antes que en una
 * pantalla rota:
 *
 *   · un campo vacío llega como `false`, no como `null` ni `''`;
 *   · un many2one llega como la tupla `[id, nombre]`, o `false`;
 *   · un `read_group` sin coincidencias devuelve `[]`, no un grupo a cero;
 *   · con `lazy: false` cada grupo trae `__count`;
 *   · `search_count` devuelve un número.
 *
 * Solo lee. Corre con `pnpm test:staging`, como el resto de la suite.
 */

const { executeKw, readGroup, searchRead } = await import('../../odoo/client.js');

describe('#13 · Costumbres de Odoo que el código da por hechas', () => {
  it('un campo de texto vacío llega como false, no como null ni cadena vacía', async () => {
    const [p] = await searchRead<{ id: number; ref: unknown }>('res.partner', [['ref', '=', false]], ['ref'], { limit: 1 });
    expect(p, 'hace falta algún partner sin referencia').toBeDefined();
    expect(p.ref).toBe(false);
  });

  it('un many2one llega como [id, nombre]', async () => {
    const [p] = await searchRead<{ company_id: unknown }>('sale.order', [['company_id', '!=', false]], ['company_id'], { limit: 1 });
    expect(p, 'hace falta algún pedido').toBeDefined();
    expect(Array.isArray(p.company_id)).toBe(true);
    const [id, nombre] = p.company_id as [unknown, unknown];
    expect(typeof id).toBe('number');
    expect(typeof nombre).toBe('string');
  });

  it('un many2one vacío llega como false', async () => {
    const [p] = await searchRead<{ parent_id: unknown }>('res.partner', [['parent_id', '=', false]], ['parent_id'], { limit: 1 });
    expect(p.parent_id).toBe(false);
  });

  it('read_group sin coincidencias devuelve [], no un grupo a cero', async () => {
    const grupos = await readGroup('account.move', [['id', '=', -1]], ['amount_total_signed:sum'], ['partner_id']);
    expect(grupos).toEqual([]);
  });

  it('read_group con lazy:false trae __count en cada grupo', async () => {
    const grupos = await readGroup<{ __count: number }>('sale.order', [['state', 'in', ['sale', 'done']]], [], ['state']);
    expect(grupos.length).toBeGreaterThan(0);
    for (const g of grupos) expect(typeof g.__count).toBe('number');
  });

  it('search_count devuelve un número', async () => {
    expect(typeof (await executeKw<number>('res.partner', 'search_count', [[['id', '=', -1]]]))).toBe('number');
  });
});
