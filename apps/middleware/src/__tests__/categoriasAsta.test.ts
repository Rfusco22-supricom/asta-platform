import { describe, expect, it } from 'vitest';
import { categoriaDe } from '@asta/shared-types';
import { mesesDeLaVentana, siguienteCategoria } from '../services/categoriasAsta.service.js';

/** Las categorías de ASTA (#131): las reglas de Marketing del 2026-10-13. */

describe('categoriaDe', () => {
  it.each([
    [16000, 4, 'DIAMANTE'],
    [15000, 3, 'DIAMANTE'],
    [14999.99, 4, 'ORO'],
    [2179.76, 4, 'ORO'],
    [2000, 3, 'ORO'],
    [1999.99, 4, 'PLATA'],
    [1225, 3, 'PLATA'],
    [1000, 3, 'PLATA'],
    [999.99, 4, 'BRONCE'],
    [500, 2, 'BRONCE'],
    [499.99, 4, 'GENERAL'],
  ])('%s USD/mes en %s meses → %s', (compra, meses, categoria) => {
    expect(categoriaDe(compra, meses).clave).toBe(categoria);
  });

  it('la fidelidad manda: un pedido grande y suelto no hace Diamante a nadie', () => {
    // 64.000 en un solo mes son 16.000 al mes, pero en 1 de 4 meses.
    expect(categoriaDe(16000, 1).clave).toBe('GENERAL');
    // Mucho, pero en dos meses: no llega a Plata (pide 3) y sí a Bronce (pide 2).
    expect(categoriaDe(1937, 2).clave).toBe('BRONCE');
  });
});

describe('siguienteCategoria', () => {
  it('dice cuánto falta al mes, cuántos meses, o las dos cosas', () => {
    expect(siguienteCategoria(1200, 4)).toEqual({ categoria: 'ORO', faltaMensual: 800, faltanMeses: 0 });
    expect(siguienteCategoria(1937, 2)).toEqual({ categoria: 'PLATA', faltaMensual: 0, faltanMeses: 1 });
    expect(siguienteCategoria(100, 1)).toEqual({ categoria: 'BRONCE', faltaMensual: 400, faltanMeses: 1 });
  });

  it('en Oro y en Diamante no hay siguiente: Diamante está bloqueado', () => {
    expect(siguienteCategoria(2179.76, 4)).toBeNull();
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
