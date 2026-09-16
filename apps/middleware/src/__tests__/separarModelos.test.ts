import { describe, expect, it } from 'vitest';
import { formasDelCodigo, separarModelos } from '../services/recomendador/separarModelos.js';

/**
 * #56 · Del texto libre de `compatibilidad_productos.modelo` a impresoras.
 *
 * Cada caso es una fila REAL de la tabla de producción (id entre paréntesis),
 * con el formato tal cual lo escribió quien la mantiene.
 */

const modelos = (texto: string, marca = 'HP') => separarModelos(texto, marca).modelos;

describe('#56 · separarModelos, con las filas reales', () => {
  it('etiqueta con dos puntos y comas (#2)', () => {
    expect(modelos('HP: M208, M209, M211, M232')).toEqual(['M208', 'M209', 'M211', 'M232']);
  });

  it('familia que se reparte entre barras (#6)', () => {
    expect(modelos('HP LaserJet 1010/1012/M1319f/M1005')).toEqual(['LaserJet 1010', 'LaserJet 1012', 'LaserJet M1319f', 'LaserJet M1005']);
  });

  it('prefijo heredado: 225 tras M201 es la M225 (#13)', () => {
    expect(modelos('HP M125/M127/M201/225')).toEqual(['M125', 'M127', 'M201', 'M225']);
  });

  it('prefijo con guion heredado: ML-1915 (#66)', () => {
    expect(modelos('ML-1916/1915, SCX-4610/4605, CF-650/651', 'SAMSUNG')).toEqual(['ML-1916', 'ML-1915', 'SCX-4610', 'SCX-4605', 'CF-650', 'CF-651']);
  });

  it('guion entre cifras separa modelos; guion pegado a letras no (#76)', () => {
    expect(modelos('Canon I-SENSYS LBP662-663-664', 'CANON')).toEqual(['I-SENSYS LBP662', 'I-SENSYS LBP663', 'I-SENSYS LBP664']);
  });

  it('nombres completos separados por barra no heredan la familia equivocada (#21)', () => {
    expect(modelos('HP LaserJet Pro M404/HP LaserJet Pro MFP M428')).toEqual(['LaserJet Pro M404', 'LaserJet Pro MFP M428']);
  });

  it('«COLOR:» es etiqueta; «Color LaserJet» es nombre (#33, #41)', () => {
    expect(modelos('HP COLOR: M155A/MFP182/M183')).toEqual(['M155A', 'MFP182', 'M183']);
    expect(modelos('HP Color LaserJet Pro M254/M280')).toEqual(['Color LaserJet Pro M254', 'Color LaserJet Pro M280']);
  });

  it('una serie numérica va con su familia: LaserJet Pro 400 M351 (#37)', () => {
    expect(modelos('HP LaserJet Pro 300/400 M351/M375')).toEqual(['LaserJet Pro 300', 'LaserJet Pro 400 M351', 'LaserJet Pro 400 M375']);
  });

  it('el color entre paréntesis se guarda; otras anotaciones se descartan (#25, #29)', () => {
    expect(separarModelos('HP M154/M180/M181 (cyan)', 'HP')).toEqual({ modelos: ['M154', 'M180', 'M181'], color: 'cian' });
    expect(separarModelos('HP M454/M479 (414)', 'HP')).toEqual({ modelos: ['M454', 'M479'], color: null });
  });

  it('sin marca delante y sin familia (#45, #85)', () => {
    expect(modelos('CP1525/CM1415fnw')).toEqual(['CP1525', 'CM1415fnw']);
    expect(modelos('ICMF3010/3030', 'CANON')).toEqual(['ICMF3010', 'ICMF3030']);
  });

  it('NO corrige el texto: «P560» se queda en P560 aunque sea la P1560 (#81)', () => {
    // Adivinarlo convertiría un error visible en uno invisible: se revisa en el panel.
    expect(modelos('HP LaserJet Pro P560/P566')).toEqual(['LaserJet Pro P560', 'LaserJet Pro P566']);
  });

  it('sin repetidos, aunque cambien mayúsculas o espacios', () => {
    expect(modelos('HP M28/m28/M 28')).toEqual(['M28']);
  });

  it('un texto sin cifras no produce modelos', () => {
    expect(modelos('HP LaserJet Pro')).toEqual([]);
    expect(modelos('')).toEqual([]);
  });
});

describe('#56 · formasDelCodigo', () => {
  it('normaliza el código', () => {
    expect(formasDelCodigo('MLT-D111S', 'SAMSUNG')).toEqual(['mltd111s']);
  });

  it('Canon: también sin «CRG», que es como sale en los nombres de Odoo', () => {
    expect(formasDelCodigo('CRG055', 'CANON')).toEqual(['crg055', '055']);
  });

  it('NO quita el color: CRG055BK no es el 055 genérico', () => {
    expect(formasDelCodigo('CRG055BK', 'Canon')).toEqual(['crg055bk', '055bk']);
  });

  it('el prefijo solo se prueba en Canon', () => {
    expect(formasDelCodigo('CRG055', 'HP')).toEqual(['crg055']);
  });
});
