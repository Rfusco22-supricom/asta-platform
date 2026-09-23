import { describe, expect, it } from 'vitest';
import { extraerImpresoras, marcaDelNombre } from '../services/recomendador/extraerImpresoras.js';

/**
 * #129 · Qué impresoras dice el nombre de un producto (Fase 2 de #56).
 *
 * Los nombres son los de producción, tal cual. Lo que se vigila, por orden de
 * importancia:
 *
 *   1. que NO proponga cuando no hay impresoras: un código de cartucho que
 *      parece una lista de modelos es el error caro de #56;
 *   2. que saque las que sí están, con su marca;
 *   3. que la evidencia permita revisar sin volver a leer el nombre entero.
 */

const nombres = (n: string, cartuchos: string[] = []) => extraerImpresoras(n, cartuchos).map((c) => c.nombre);
const marcas = (n: string, cartuchos: string[] = []) => [...new Set(extraerImpresoras(n, cartuchos).map((c) => c.marca))];

describe('#129 · Cuándo NO se propone nada', () => {
  it('un chip con dos códigos de cartucho no es una lista de impresoras', () => {
    expect(extraerImpresoras('ASTA CHIP W1105A/105A VERSION 3')).toEqual([]);
  });

  it('un cartucho suelto tampoco, por más que el nombre diga la marca', () => {
    expect(extraerImpresoras('HP CARTUCHO 667 BLACK')).toEqual([]);
    expect(extraerImpresoras('CANON CARTUCHO DE TINTA PG-145 XL -NEGRO')).toEqual([]);
    expect(extraerImpresoras('CANON TINTA GI-16 - BOTELLA - NEGRO')).toEqual([]);
  });

  it('cuatro códigos de cartucho en fila no son cuatro impresoras', () => {
    expect(extraerImpresoras('ASTA TONER CB435A/CB436A/CE278A/285')).toEqual([]);
  });

  it('un solo código no basta: suelto en un nombre casi siempre es el cartucho', () => {
    expect(extraerImpresoras('ASTA TONER PARA M404')).toEqual([]);
  });

  it('el cartucho del propio producto nunca se propone como impresora', () => {
    expect(nombres('ASTA TONER M404 M428 M304', ['M304'])).toEqual(['M404', 'M428']);
  });

  it('y tampoco cuando abre la lista: ahí no vale con cortar el fragmento', () => {
    // El cartucho es el PRIMER código, así que el fragmento empieza en él y no
    // se puede cortar por delante: lo que lo quita es la lista de cartuchos.
    expect(nombres('ASTA TONER M304 M404 M428', ['M304'])).toEqual(['M404', 'M428']);
  });
});

describe('#129 · Las que sí están', () => {
  it('familia y barras: HP LaserJet', () => {
    const n = 'ASTA TONER HP CE255A LaserJet P3010/3015d/3015dn/3015n/3015x/3016/Pro M521/MFP M525c';
    expect(marcas(n)).toEqual(['HP']);
    expect(nombres(n)).toEqual([
      'LaserJet P3010',
      'LaserJet P3015d',
      'LaserJet P3015dn',
      'LaserJet P3015n',
      'LaserJet P3015x',
      'LaserJet P3016',
      'LaserJet Pro M521',
      'LaserJet MFP M525c',
    ]);
  });

  it('el código del cartucho, que va ANTES de la familia, no entra', () => {
    expect(nombres('ASTA TONER HP CE255A LaserJet P3010/3015d')).not.toContain('CE255A');
  });

  it('tanda sin familia: Samsung ML, con el cartucho MLT- en el mismo nombre', () => {
    const n = 'ASTA TONER SAMSUNG MLT-D105S ML-1916/1915/1910/1911/2525/2580';
    expect(marcas(n)).toEqual(['Samsung']);
    expect(nombres(n)).toEqual(['ML-1916', 'ML-1915', 'ML-1910', 'ML-1911', 'ML-2525', 'ML-2580']);
  });

  it('tanda de HP con el cartucho delante y guiones entre modelos', () => {
    const n = 'ASTA TONER CF258 CON CHIP M304a-M404DW-M404DN-M404N-MFP M428FDW-M428DW';
    expect(marcas(n)).toEqual(['HP']);
    // La "MFP" que trae el nombre se queda pegada a las que van detrás: es parte
    // de cómo se llama esa impresora, y quien revise lo ve con la evidencia.
    expect(nombres(n)).toEqual(['M304a', 'M404DW', 'M404DN', 'M404N', 'MFP M428FDW', 'MFP M428DW']);
  });

  it('Epson enumera sus L con comas', () => {
    const n = 'EPSON L1110, L3110, L3150, L5190  BLACK';
    expect(marcas(n)).toEqual(['Epson']);
    expect(nombres(n)).toEqual(['L1110', 'L3110', 'L3150', 'L5190']);
  });

  it('Brother escribe la familia pegada al modelo', () => {
    const n = 'BROTHER TONER TN-660 HL-L2300D/DCP-L2540DW';
    expect(marcas(n)).toEqual(['Brother']);
    expect(nombres(n)).toEqual(['HL-L2300D', 'DCP-L2540DW']);
  });

  it('la referencia larga del final no es un modelo, y el guion suelto tampoco', () => {
    // Nombre real, con la errata de "BLAKC" incluida: por eso no vale con cortar
    // por la palabra de color.
    expect(nombres('EPSON TINTA L1110-L3110-L3150-L5190- BLAKC T544120AL')).toEqual(['L1110', 'L3110', 'L3150', 'L5190']);
  });

  it('el parentesis cierra la lista: "CANON TONER 128 (MF4450 / MF4570)"', () => {
    expect(nombres('CANON TONER 128 (MF4450 / MF4570)')).toEqual(['MF4450', 'MF4570']);
  });

  it('una cifra suelta seguida de otro codigo son dos impresoras, no una', () => {
    // "2168 SCX-3400" salia como un solo modelo con ese nombre imposible.
    expect(nombres('ASTA TONER SAMSUNG MLT-D101S ML-2160/2166/2168 SCX-3400/3401')).toEqual([
      'ML-2160',
      'ML-2166',
      'ML-2168',
      'SCX-3400',
      'SCX-3401',
    ]);
  });

  it('Canon imageCLASS', () => {
    expect(nombres('CANON TONER 057 imageCLASS LBP226dw/LBP228x/MF445dw')).toEqual([
      'imageCLASS LBP226dw',
      'imageCLASS LBP228x',
      'imageCLASS MF445dw',
    ]);
  });
});

describe('#129 · Lo que hace falta para revisar', () => {
  it('la evidencia es el fragmento del nombre, no el nombre entero', () => {
    const c = extraerImpresoras('ASTA TONER HP CE255A LaserJet P3010/3015d NEGRO');
    expect(c[0].evidencia).toBe('LaserJet P3010/3015d');
    expect(c[0].evidencia).not.toContain('CE255A');
  });

  it('el normalizado es el que busca el kiosco: sin mayúsculas, espacios ni guiones', () => {
    const [c] = extraerImpresoras('ASTA TONER SAMSUNG MLT-D105S ML-1916/1915');
    expect(c.nombreNormalizado).toBe('ml1916');
  });

  it('no repite una impresora que el nombre menciona dos veces', () => {
    expect(nombres('ASTA TONER HP LaserJet M404/M404dn/M404')).toEqual(['LaserJet M404', 'LaserJet M404dn']);
  });

  it('ni cuando la repetición la crea el arrastre de la familia', () => {
    // "Pro M521" se convierte en "LaserJet Pro M521" al arrastrar la familia, y
    // entonces choca con la que el nombre ya escribía entera.
    expect(nombres('ASTA TONER HP LaserJet Pro M521/Pro M521')).toEqual(['LaserJet Pro M521']);
  });

  it('la marca sale del nombre cuando está', () => {
    expect(marcaDelNombre('ASTA TONER HP CE255A')).toBe('HP');
    expect(marcaDelNombre('ASTA TONER CF258 CON CHIP')).toBeNull();
  });
});
