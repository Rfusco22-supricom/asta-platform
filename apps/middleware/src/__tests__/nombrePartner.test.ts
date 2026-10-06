import { describe, expect, it } from 'vitest';
import { nombrePartner } from '../utils/nombrePartner.js';

/**
 * Odoo devuelve `false` en `res.partner.name` si la ficha no tiene nombre (la
 * 137384 de producción). Antes, `name.trim()` tumbaba el alta de ese cliente en
 * cada sync completo.
 */
describe('nombrePartner', () => {
  it('el nombre, sin espacios de sobra', () => {
    expect(nombrePartner({ id: 1, name: '  SUPRICOM CCS 21, C.A.  ' })).toBe('SUPRICOM CCS 21, C.A.');
  });

  it.each([false, '', '   ', null, undefined] as const)('sin nombre (%s): «Cliente #id»', (name) => {
    expect(nombrePartner({ id: 137384, name })).toBe('Cliente #137384');
  });
});
