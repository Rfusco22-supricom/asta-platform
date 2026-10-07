import { describe, expect, it } from 'vitest';
import { clavesDe, colorDe, equivalentesAsta, esAstaDeVerdad, esComponente, type ProductoConsumible } from '../services/impulsa/equivalentesAsta.js';

/**
 * «Pásale a ASTA»: qué ASTA sirve en lugar de un consumible de otra marca. Los
 * nombres son de la instancia (catálogo del 5-oct-2026).
 */

let id = 0;
const p = (name: string, default_code: string | false = false): ProductoConsumible => ({ id: ++id, name, default_code });

const CATALOGO = [
  p('ASTA TONER CF287X NEGRO', 'A-CF287X'),
  p('ASTA TONER CF217A NEGRO', 'A-CF217A'),
  p('ASTA TONER CANON CRG-054 Y YELLOW', 'A-CRG-054Y'),
  p('ASTA TONER CANON CRG-054 BK NEGRO', 'A-CRG-054BK'),
  p('ASTA TINTA EPSON 544 NEGRO 65ML', 'A-544BK'),
  p('ASTA TINTA CANON GI-190 NEGRO 100ML', 'A-GI-190BK'),
  p('ASTA POLVO POWDER A CF217A NEGRO', 'A-PW-217'),
  p('ASTA CHIP CF217A', 'A-CHIP-217'),
  p('CANON TONER CRG-047 ORIGINAL', 'CRG-047'), // de la marca 951, pero original revendido
  p('ASTA TONER W22022A(414A) NO CHIP Y', 'A-W2022A'),
];

const nombres = (lista: ProductoConsumible[]) => lista.map((x) => x.name);

describe('equivalentes ASTA', () => {
  it('mismo cartucho, mismo tipo: HP 87X → ASTA CF287X', () => {
    expect(nombres(equivalentesAsta(p('HP TONER 87X NEGRO, LASERJET ORIGINAL', 'CF287X'), CATALOGO))).toEqual(['ASTA TONER CF287X NEGRO']);
  });

  it('el color manda cuando los dos lo dicen: CRG-054 amarillo no es el negro', () => {
    expect(nombres(equivalentesAsta(p('CANON TONER CRG-054 YELLOW ORIGINAL', '3021C001AA'), CATALOGO))).toEqual(['ASTA TONER CANON CRG-054 Y YELLOW']);
    expect(nombres(equivalentesAsta(p('CANON TONER CRG-054 NEGRO ORIGINAL', '3024C001AA'), CATALOGO))).toEqual(['ASTA TONER CANON CRG-054 BK NEGRO']);
  });

  it('Epson T544 y 544 son el mismo cartucho', () => {
    expect(clavesDe(p('EPSON TINTA T544 NEGRO', 'T544120-AL'))).toEqual(clavesDe(p('ASTA TINTA EPSON 544 NEGRO 65ML', 'A-544BK')));
    expect(nombres(equivalentesAsta(p('EPSON BOTELLA DE TINTA T544 NEGRO', 'T544120-AL'), CATALOGO))).toEqual(['ASTA TINTA EPSON 544 NEGRO 65ML']);
  });

  it('nunca un componente suelto ni un original revendido de la marca', () => {
    // El CF217A original tiene polvo y chip ASTA del mismo código: solo vale el tóner.
    expect(nombres(equivalentesAsta(p('HP TONER CF217A NEGRO ORIGINAL', 'CF217A'), CATALOGO))).toEqual(['ASTA TONER CF217A NEGRO']);
    expect(nombres(equivalentesAsta(p('CANON TONER CRG-047', 'CRG047'), CATALOGO))).toEqual([]);
  });

  it('tinta no es tóner, aunque comparta código', () => {
    expect(equivalentesAsta(p('CANON TONER GI-190 NEGRO', 'X1'), CATALOGO)).toEqual([]);
  });

  it('sin código de cartucho en el nombre, no se empareja', () => {
    expect(equivalentesAsta(p('XEROX TONER NEGRO MOHAVE B230/B225/B235', '006R04403'), CATALOGO)).toEqual([]);
  });
});

describe('piezas de la regla', () => {
  it('color: por el nombre, por la letra final o por la referencia', () => {
    expect(colorDe(p('HP TONER 230A BLACK ORIGINAL'))).toBe('K');
    expect(colorDe(p('ASTA TONER W22022A(414A) NO CHIP Y'))).toBe('Y');
    expect(colorDe(p('BROTHER TONER TN-227', 'TN-227C'))).toBe('C');
    expect(colorDe(p('HP TONER CONTRACTUAL W2021XC', 'W2021XC-EX'))).toBe('C');
    expect(colorDe(p('HP TONER COLOR LASERJET 410A', 'CF410A'))).toBeNull();
    expect(colorDe(p('HP CARTUCHO 664 TRI-COLOR', 'F6V28AL'))).toBe('TRICOLOR');
  });

  it('componente: chip suelto sí; «con chip» y «no chip» no', () => {
    expect(esComponente('ASTA CHIP CF217A')).toBe(true);
    expect(esComponente('ASTA POLVO POWDER A CF217A')).toBe(true);
    expect(esComponente('ASTA TONER W2313A CON CHIP')).toBe(false);
    expect(esComponente('ASTA TONER W22022A(414A) NO CHIP Y')).toBe(false);
    expect(esComponente('ASTA TONER SAMSUNG MLT-D111S NEGRO NUEVO CHIP')).toBe(false);
    expect(esComponente('ASTA CHIP A-CRG.057H ORIGINAL RECYCLE CHIP')).toBe(true);
  });

  it('ASTA de verdad: por el nombre o por la referencia «A-»', () => {
    expect(esAstaDeVerdad(p('ASTA TONER CF217A', 'A-CF217A'))).toBe(true);
    expect(esAstaDeVerdad(p('TONER CF217A', 'A-CF217A'))).toBe(true);
    expect(esAstaDeVerdad(p('CANON TONER CRG-047', 'CRG-047'))).toBe(false);
  });
});
