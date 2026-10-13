import { describe, expect, it } from 'vitest';
import { SIN_INTERCOMPANIA, SIN_INTERCOMPANIA_LINEA, esDelGrupo } from '../services/intercompania.js';
import { LINEAS_ASTA } from '../services/ventasAsta.service.js';

/*
 * Las ventas entre empresas del grupo no son ventas (`intercompania.ts`).
 *
 * La lista es la del panel de SUPRICOM: si los dos paneles la escriben distinto,
 * vuelven a dar cifras distintas y nadie sabe cuál creer.
 */

describe('intercompañía · el dominio de Odoo', () => {
  it('va por el cliente comercial, en la factura y en la línea', () => {
    expect(SIN_INTERCOMPANIA.slice(0, 2)).toEqual(['commercial_partner_id', 'not any']);
    expect(SIN_INTERCOMPANIA_LINEA.slice(0, 2)).toEqual(['move_id.commercial_partner_id', 'not any']);
    expect(SIN_INTERCOMPANIA[2]).toBe(SIN_INTERCOMPANIA_LINEA[2]);
  });

  it('une con OR los nombres, los RIF y las compañías del Odoo', () => {
    const dominio = SIN_INTERCOMPANIA[2] as unknown[];
    const hojas = dominio.filter((x) => Array.isArray(x));
    const ors = dominio.filter((x) => x === '|');

    expect(hojas).toEqual([
      ['name', 'ilike', 'supricom'],
      ['name', 'ilike', 'office solutions center'],
      ['name', 'ilike', 'ofimaster'],
      ['vat', 'ilike', '501193738'],
      ['vat', 'ilike', '31163115'],
      ['vat', 'ilike', '155595002'],
      ['vat', 'ilike', '1576706'],
      ['ref_company_ids', '!=', false],
    ]);
    // En notación polaca, n hojas en OR llevan n-1 '|': con uno menos, la última
    // hoja quedaría en AND y no excluiría casi nada.
    expect(ors).toHaveLength(hojas.length - 1);
  });

  it('todo lo que parte de LINEAS_ASTA ya la lleva', () => {
    expect(LINEAS_ASTA).toContain(SIN_INTERCOMPANIA_LINEA);
  });
});

describe('intercompañía · Smartbit, por nombre y RIF', () => {
  it.each([
    ['SUPRICOM CCS,  ASTA', null],
    ['Office Solutions Center 2004, C.A.', 'J-00000000-0'],
    ['OFIMASTER PANAMA', null],
    ['Cliente con otro nombre', 'J-31163115-1'],
    ['Cliente con otro nombre', 'RUC155595002'],
  ])('«%s» (%s) es del grupo', (nombre, rif) => {
    expect(esDelGrupo(nombre, rif)).toBe(true);
  });

  it.each([
    ['CORPORACION SERVITEMS C.A', 'J-12345678-9'],
    ['', null],
    [null, undefined],
  ])('«%s» (%s) no lo es', (nombre, rif) => {
    expect(esDelGrupo(nombre, rif)).toBe(false);
  });
});
