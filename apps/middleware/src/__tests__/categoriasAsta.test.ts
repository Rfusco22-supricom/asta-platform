import { describe, expect, it } from 'vitest';
import { categoriaDe } from '@asta/shared-types';
import { mesesDeLaVentana, siguienteCategoria } from '../services/categoriasAsta.service.js';

/** Las categorías de ASTA (#131): las reglas de Marketing del 2026-10-13. */

describe('categoriaDe', () => {
  it.each([
    [4920, 4, 'DIAMANTE'],
    [4500, 3, 'DIAMANTE'],
    [4499.99, 4, 'ORO'],
    [2179.76, 4, 'ORO'],
    [1500, 3, 'ORO'],
    [1225, 3, 'PLATA'],
    [900, 3, 'PLATA'],
    [899.99, 4, 'BRONCE'],
    [500, 2, 'BRONCE'],
    [499.99, 4, 'GENERAL'],
  ])('%s USD/mes en %s meses → %s', (compra, meses, categoria) => {
    expect(categoriaDe(compra, meses).clave).toBe(categoria);
  });

  it('la fidelidad manda: un pedido grande y suelto no hace Diamante a nadie', () => {
    // 19.680 en un solo mes son 4.920 al mes, pero en 1 de 4 meses.
    expect(categoriaDe(4920, 1).clave).toBe('GENERAL');
    // Mucho, pero en dos meses: no llega a Plata (pide 3) y sí a Bronce (pide 2).
    expect(categoriaDe(1937, 2).clave).toBe('BRONCE');
  });
});

describe('siguienteCategoria', () => {
  it('dice cuánto falta al mes, cuántos meses, o las dos cosas', () => {
    expect(siguienteCategoria(2179.76, 4)).toEqual({ categoria: 'DIAMANTE', faltaMensual: 2320.24, faltanMeses: 0 });
    expect(siguienteCategoria(1937, 2)).toEqual({ categoria: 'PLATA', faltaMensual: 0, faltanMeses: 1 });
    expect(siguienteCategoria(100, 1)).toEqual({ categoria: 'BRONCE', faltaMensual: 400, faltanMeses: 1 });
  });

  it('en Diamante no hay siguiente', () => {
    expect(siguienteCategoria(5000, 4)).toBeNull();
  });
});

describe('mesesDeLaVentana', () => {
  it('los cuatro últimos meses completos: el mes en curso no entra', () => {
    expect(mesesDeLaVentana(new Date('2026-10-13T12:00:00Z'))).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('cruza el año', () => {
    expect(mesesDeLaVentana(new Date('2027-02-01T00:00:00Z'))).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
  });
});
