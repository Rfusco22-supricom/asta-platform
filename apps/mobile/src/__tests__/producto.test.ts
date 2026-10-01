import { describe, expect, it } from 'vitest';
import type { ProductoCompatible } from '../api.js';
import { clase, codigosDeCartucho, esAsta, ordenarPorStock, titulo } from '../producto.js';

/**
 * #40 · Cómo se presenta cada producto en el kiosco.
 *
 * Los nombres son reales, los de la HP P1606 en el ERP: lo que importa es no
 * venderle polvo a quien busca un cartucho, y que lo que hay salga primero.
 */

const impresora = { id: 1726, marca: 'HP', nombre: 'P1606' };

const producto = (id: number, nombre: string, extra: Partial<ProductoCompatible> = {}): ProductoCompatible => ({
  id,
  templateId: id,
  sku: null,
  nombre,
  stock: 'disponible',
  tipo: 'compatible',
  cartuchos: [{ marca: 'HP', codigo: 'CE278A', tipo: 'toner', color: null, rendimientoPaginas: null }],
  ...extra,
});

describe('presentación del producto', () => {
  it('reconoce la marca propia por el nombre del ERP', () => {
    expect(esAsta(producto(1, 'ASTA TONER CB435A/CB436A/CE278A/285'))).toBe(true);
    expect(esAsta(producto(2, 'HP TONER P1566 / P1606 BLACK ORIGINAL'))).toBe(false);
    // «ASTAR…» no es Asta.
    expect(esAsta(producto(3, 'ASTARTE TONER'))).toBe(false);
  });

  it('distingue el polvo de recarga del tóner', () => {
    expect(clase(producto(1, 'ASTA POLVO POWDER A CB435A/CB436A/CE278A/285 NEGRO'))).toBe('polvo');
    expect(clase(producto(2, 'ASTA TONER CB435A/CB436A/CE278A/285'))).toBe('toner');
  });

  it('da un título que se entiende de pie', () => {
    expect(titulo(producto(1, 'ASTA TONER CB435A'), impresora)).toBe('Tóner compatible Asta');
    expect(titulo(producto(2, 'HP TONER P1606 BLACK ORIGINAL', { tipo: 'original' }), impresora)).toBe('Tóner original HP');
    expect(titulo(producto(3, 'ASTA POLVO TONER POWDER'), impresora)).toBe('Polvo de recarga Asta');
  });

  it('junta los códigos de cartucho sin repetir', () => {
    const otro = producto(2, 'X', { cartuchos: [{ marca: 'HP', codigo: 'CE285A', tipo: 'toner', color: null, rendimientoPaginas: null }] });
    expect(codigosDeCartucho([producto(1, 'A'), producto(3, 'B'), otro])).toEqual(['CE278A', 'CE285A']);
  });

  it('pone primero lo que hay, sin desordenar el resto', () => {
    const lista = [
      producto(1, 'a', { stock: 'agotado' }),
      producto(2, 'b', { stock: 'disponible' }),
      producto(3, 'c', { stock: 'bajo' }),
      producto(4, 'd', { stock: 'agotado' }),
      producto(5, 'e', { stock: 'disponible' }),
    ];
    expect(ordenarPorStock(lista).map((p) => p.id)).toEqual([2, 5, 3, 1, 4]);
  });
});
