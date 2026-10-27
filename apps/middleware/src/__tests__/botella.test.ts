import { describe, expect, it } from 'vitest';
import { esBotella } from '../services/recomendador/botella.js';

/**
 * Botella de tinta o cartucho: el cliente de una EcoTank pide «la tinta», el
 * de una DeskJet, «el cartucho». Códigos reales del catálogo.
 */
describe('Botella o cartucho', () => {
  it('las botellas de cada fabricante', () => {
    expect(['T544', '544', 'T664', 'T673', 'T504', 'T49H'].every((c) => esBotella('Epson', c))).toBe(true);
    expect(['GT53', 'GT52', '32XL'].every((c) => esBotella('HP', c))).toBe(true);
    expect(['GI-11', 'GI-190'].every((c) => esBotella('Canon', c))).toBe(true);
    expect(['BT5001', 'BTD60BK'].every((c) => esBotella('Brother', c))).toBe(true);
  });

  it('los cartuchos de tinta no son botellas', () => {
    expect(['667', '664XL', '954XL', 'GT5'].some((c) => esBotella('HP', c))).toBe(false);
    expect(['PG-145XL', 'CL-146', 'CLI-171'].some((c) => esBotella('Canon', c))).toBe(false);
    expect(['T941', '748XXL', 'T40W'].some((c) => esBotella('Epson', c))).toBe(false);
  });

  it('una marca sin botellas conocidas, o un tóner: cartucho', () => {
    expect(esBotella('Samsung', 'T544')).toBe(false);
    expect(esBotella('HP', 'CF258A')).toBe(false);
  });
});
