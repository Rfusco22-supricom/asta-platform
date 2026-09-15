import { describe, expect, it } from 'vitest';
import { extraerCartuchos } from '../services/recomendador/extraerCartuchos.js';

/**
 * #56 · Qué cartucho es un producto, leído de su nombre y su referencia.
 *
 * Todos los casos son nombres y referencias REALES de la instancia de Odoo, sacados
 * de los consumibles más vendidos y de los fallos encontrados al medir el
 * catálogo. La mitad de los tests son lo que NO debe salir: aquí un falso
 * positivo es un tóner recomendado para una impresora en la que no entra.
 */

const codigos = (nombre: string, ref: string | null) => extraerCartuchos(nombre, ref).map((c) => `${c.marca}:${c.codigo}`);

describe('#56 · Los más vendidos', () => {
  it.each([
    ['CANON  CARTUCHO DE TINTA PG-145 XL -NEGRO', '8274B001AA', ['Canon:PG-145XL']],
    ['CANON CARTUCHO CL-146 XL COLOR ORIGINAL', '8276B001AA', ['Canon:CL-146XL']],
    ['HP CARTUCHO 667 BLACK ', '3YM79AL', ['HP:667']],
    ['CANON TONER T03  NEGRO', '2725C001AA', ['Canon:T03']],
    ['HP TONER 105A NEGRO ORIGINAL', 'W1105A', ['HP:105A', 'HP:W1105A']],
    ['CANON TINTA GI-16 - BOTELLA - NEGRO', '4408C001AA', ['Canon:GI-16']],
    ['HP CARTUCHO 954XL BLACK  ORIGINAL INK CARTRIDGE', 'L0S71AL', ['HP:954XL']],
    ['CANON TONER 125 NEGRO', '3484B001AA', ['Canon:125']],
    ['HP TINTA GT53 90ml BLACK', '1VV22AL', ['HP:GT53']],
    ['CANON TONER 067 H NEGRO, ALTO RENDIMIENTO', '5106C001AA', ['Canon:067H']],
    ['CANON GPR-58 - TAMBOR DE IMAGEN', '2186C003BA-EX', ['Canon:GPR-58']],
    ['HP CARTUCHO DE TINTA 954 - NEGRO', 'L0S59AL', ['HP:954']],
  ] as const)('%s', (nombre, ref, esperado) => {
    expect(codigos(nombre, ref)).toEqual(esperado);
  });

  it('Epson: el cartucho sale de la referencia, porque el nombre solo lista impresoras', () => {
    // "L1110, L3110…" son las impresoras, no el cartucho.
    expect(codigos('EPSON L1110, L3110, L3150, L5190  BLACK', 'T544120-AL')).toEqual(['Epson:T544']);
  });

  it('la referencia no aporta números comerciales de HP: "GT53 120" no es un cartucho 120', () => {
    expect(codigos('HP TINTA GT53 NEGRO', 'GT53 120')).toEqual(['HP:GT53']);
  });

  it('el número de pieza no se confunde con un cartucho: "3YM79AL" no es el 79', () => {
    expect(codigos('HP CARTUCHO 667 COLOR', '3YM78AL')).toEqual(['HP:667']);
  });
});

describe('#56 · Compatibles ASTA', () => {
  it('un compatible que cubre varios cartuchos los propone todos', () => {
    expect(codigos('ASTA TONER CB435A/CB436A/CE278A/285', 'A-CB435A-CE278A')).toEqual(['HP:CB435A', 'HP:CB436A', 'HP:CE278A']);
  });

  it('el cartucho que sustituye sale de la referencia sin el prefijo A-', () => {
    expect(codigos('ASTA BROTHER DR820 - UNIDAD DE TAMBOR', 'A-DR-820')).toEqual(['Brother:DR-820']);
    expect(codigos('ASTA TONER SAMSUNG MLT-D111S NEGRO NUEVO CHIP', 'A-MLT-D111S')).toEqual(['Samsung:MLT-D111S']);
  });

  it('Epson ASTA: el cartucho está en la referencia, con el color pegado', () => {
    // El nombre no lo dice ("ASTA TINTA EPSON NEGRO"), y con el prefijo A- el
    // guion taparía el número.
    expect(codigos('ASTA TINTA EPSON NEGRO', 'A-664BK')).toEqual(['Epson:664']);
  });

  it('un compatible de dos marcas propone las dos', () => {
    expect(codigos('ASTA TONER CANON CRG 057H / A-CF258X CON CHIP', 'A-057H')).toEqual(['HP:CF258X', 'Canon:057H']);
    expect(codigos('ASTA TONER CF230A NEGRO/ 051 CANON', 'A-CF230A')).toEqual(['HP:CF230A', 'Canon:051']);
  });
});

describe('#56 · Sufijos que no cambian el cartucho', () => {
  it('HP: contrato (C) y paquete (D)', () => {
    expect(codigos('HP TONER W2023XC MAGENTA CONTRACTUAL ', 'W2023XC-EX')).toEqual(['HP:W2023X']);
    expect(codigos('HP TONER 78A NEGRO, LASERJET ORIGINAL (PACK DE 2)', 'CE278AD')).toEqual(['HP:78A', 'HP:CE278A']);
  });

  it('Canon: el color pegado, y sin duplicar "PFI-050" como "050"', () => {
    expect(codigos('CANON TINTA PFI-050BK TC-20 NEGRO 70ML', '5698C001AA')).toEqual(['Canon:PFI-050']);
    expect(codigos('ASTA TONER CRG-055BK', 'A-CRG-055BK')).toEqual(['Canon:055']);
  });
});

describe('#56 · Lo que NO es un cartucho', () => {
  it('productos de CONSUMIBLES que no son consumibles de impresión', () => {
    expect(codigos('CANON SX740 HS - CAMARA FOTOGRAFICA PROFESIONAL', '2955C001AA')).toEqual([]);
    expect(codigos('Licencia Windows 11 PRO', 'WINDOWS11PRO')).toEqual([]);
  });

  it('el modelo de impresora con guion no es un cartucho: "LQ-590", "FX-890"', () => {
    expect(codigos('EPSON S015337 - CINTA ORIGINAL LQ-590', 'S015337')).toEqual([]);
    expect(codigos('EPSON CINTA ORIGINAL FX-890', 'S015329')).toEqual([]);
  });

  it('"CRG-047" en un nombre que dice LASERJET es Canon, no el HP 47', () => {
    expect(codigos('[CRG-047] TONER CANON NEGRO, LASERJET ORIGINAL ', null)).toEqual(['Canon:047']);
  });

  it('los números de un cabezal son series de impresora, no cartuchos', () => {
    expect(codigos('HP CABEZAL COLOR PARA SERIES 100, 300, 400, 500,600', null)).toEqual([]);
  });

  it('los mililitros no son un cartucho', () => {
    expect(codigos('HP TINTA GT53 90 ml BLACK', null)).toEqual(['HP:GT53']);
  });

  it('sin marca, un número suelto no se propone', () => {
    expect(codigos('TONER PARA LA 1643', 'T06EOC')).toEqual([]);
  });
});

describe('#56 · Forma de cada candidato', () => {
  it('lleva el código normalizado y la evidencia literal para la revisión', () => {
    expect(extraerCartuchos('CANON  CARTUCHO DE TINTA PG-145 XL -NEGRO', '8274B001AA')).toEqual([
      { marca: 'Canon', codigo: 'PG-145XL', codigoNormalizado: 'pg145xl', evidencia: 'PG-145 XL' },
    ]);
  });
});
