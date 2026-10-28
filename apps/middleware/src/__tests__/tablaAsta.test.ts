import { describe, expect, it } from 'vitest';
import { TABLA_ASTA } from '../services/recomendador/tablaAsta.js';

/**
 * #56 · La tabla de la fábrica de ASTA, ya convertida.
 *
 * `tablaAsta.json` lo generan dos scripts a partir del Excel, así que lo que se
 * vigila aquí no es la lógica —esa está en `separarModelos`— sino que el
 * fichero generado siga diciendo lo que creemos: que las filas tienen forma,
 * que se puede llegar a la celda de la que salió cada una, y que unas cuantas
 * que comprobé a mano contra la web del fabricante siguen igual.
 *
 * Si alguien regenera con una tabla nueva y algo se tuerce, falla aquí y no en
 * el kiosco delante de un cliente.
 */

const porCartucho = (codigo: string) => TABLA_ASTA.filter((f) => f.cartuchos.some((c) => c.toLowerCase() === codigo.toLowerCase()));

describe('#56 · Forma de la tabla', () => {
  it('trae las seis marcas que vendemos y ninguna más', () => {
    expect([...new Set(TABLA_ASTA.map((f) => f.marca))].sort()).toEqual(['Brother', 'Canon', 'Epson', 'HP', 'Samsung', 'Xerox']);
  });

  it('cada fila lleva cartucho, impresoras y de dónde salió', () => {
    for (const f of TABLA_ASTA) {
      expect(f.cartuchos.length, JSON.stringify(f)).toBeGreaterThan(0);
      expect(f.impresoras.length, JSON.stringify(f)).toBeGreaterThan(0);
      // La hoja y la fila del Excel: quien valide tiene que poder ir a la celda.
      expect(f.fuentes[0]).toMatch(/hoja .+ · fila \d+$/);
      expect(f.consultado).toBe('2026-08-28');
    }
  });

  it('ningún código es un universal: esos dirían que un original sirve donde no', () => {
    // «CB435A/CE285A/CB436A» en una sola celda lleva la unión de las máquinas de
    // los tres. El extractor los deja fuera; si uno se cuela, se nota aquí.
    for (const f of TABLA_ASTA) for (const c of f.cartuchos) expect(c, JSON.stringify(f)).not.toContain('/');
  });

  it('ningún nombre de impresora arrastra la marca delante', () => {
    for (const f of TABLA_ASTA.slice(0, 400)) {
      for (const i of f.impresoras) expect(i.toLowerCase().startsWith(f.marca.toLowerCase()), `${f.marca}: ${i}`).toBe(false);
    }
  });
});

describe('#56 · Filas comprobadas a mano contra la web del fabricante', () => {
  it('el 58A da las mismas máquinas que la tienda de HP, y además la M304a', () => {
    const [fila] = porCartucho('CF258A');
    expect(fila.impresoras).toEqual(
      expect.arrayContaining(['LaserJet Pro M404n', 'LaserJet Pro M404dn', 'LaserJet Pro M404dw', 'LaserJet Enterprise M406dn', 'LaserJet Pro M304a']),
    );
  });

  it('el 150A da modelos donde HP solo publica rangos («M109-M112»)', () => {
    const [fila] = porCartucho('W1500A');
    expect(fila.impresoras).toEqual(expect.arrayContaining(['LaserJet M111a', 'LaserJet M111w', 'LaserJet MFP M141a']));
  });

  it('el T06 es de la imageRUNNER 1643, que Canon no publica en ninguna ficha', () => {
    const [fila] = porCartucho('T06');
    expect(fila.marca).toBe('Canon');
    expect(fila.impresoras).toEqual(['imageRUNNER 1643i', 'imageRUNNER 1643P']);
  });

  it('el CRG-125 coincide con lo que dice Canon USA', () => {
    const [fila] = porCartucho('CRG-125');
    expect(fila.impresoras).toEqual(expect.arrayContaining(['imageCLASS LBP6000', 'imageCLASS LBP6030w', 'imageCLASS MF3010']));
  });

  it('los juegos de color no se pierden: la celda combinada se expande', () => {
    // En el Excel, los cuatro colores comparten una celda de máquinas escrita en
    // la fila del negro. Sin expandirla se perdían tres de cada cuatro filas.
    const colores = TABLA_ASTA.filter((f) => f.cartuchos.some((c) => /^W230[0-3]A$/i.test(c)));
    expect(colores.length).toBeGreaterThanOrEqual(4);
    for (const f of colores) expect(f.impresoras).toEqual(expect.arrayContaining(['Color LaserJet Pro 4203dn']));
  });

  it('una lista separada por espacios se parte: «2168 SCX-3400» son dos', () => {
    const [fila] = porCartucho('MLT-D101S');
    expect(fila.impresoras).toEqual(expect.arrayContaining(['ML-2168', 'SCX-3400']));
    expect(fila.impresoras.some((i) => /\d\s+[A-Z]/.test(i))).toBe(false);
  });
});
