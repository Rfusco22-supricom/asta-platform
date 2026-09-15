import { describe, expect, it } from 'vitest';
import { buscarModelos, distanciaEdicion, type ModeloBuscable } from '../services/recomendador/buscarModelos.js';
import { normalizarCodigoCartucho, normalizarModelo } from '../services/recomendador/normalizar.js';

/**
 * #38 · Búsqueda difusa de modelos de impresora.
 *
 * Criterio del issue: 10 variantes tipeadas a mano del mismo modelo encuentran la
 * impresora correcta. Aquí se exige además lo que el issue no dice y más importa:
 * que **no encuentren otra**. El catálogo de prueba está hecho de vecinos a
 * propósito —HL-L2350DW junto a HL-L2370DW y HL-L2395DW, L3150 junto a L3110 y
 * L3250—, que es donde una búsqueda floja se equivoca.
 *
 * Los modelos van SIN aliases salvo donde se indica: la búsqueda tiene que
 * funcionar con el nombre del fabricante tal cual, antes de que nadie cargue un
 * alias.
 */

const CATALOGO: ModeloBuscable[] = [
  { id: 1, marca: 'Brother', nombre: 'HL-L2350DW', aliases: [] },
  { id: 2, marca: 'Brother', nombre: 'HL-L2370DW', aliases: [] },
  { id: 3, marca: 'Brother', nombre: 'HL-L2395DW', aliases: [] },
  { id: 4, marca: 'Brother', nombre: 'DCP-L2550DW', aliases: [] },
  { id: 5, marca: 'Brother', nombre: 'MFC-L2710DW', aliases: [] },
  { id: 6, marca: 'Brother', nombre: 'HL-1212W', aliases: [] },
  { id: 10, marca: 'HP', nombre: 'LaserJet Pro M404dn', aliases: [] },
  { id: 11, marca: 'HP', nombre: 'LaserJet Pro M404n', aliases: [] },
  { id: 12, marca: 'HP', nombre: 'LaserJet Pro M404dw', aliases: [] },
  { id: 13, marca: 'HP', nombre: 'LaserJet Pro MFP M428fdw', aliases: [] },
  { id: 14, marca: 'HP', nombre: 'LaserJet P1102w', aliases: [] },
  { id: 15, marca: 'HP', nombre: 'DeskJet Ink Advantage 2775', aliases: [] },
  { id: 20, marca: 'Epson', nombre: 'EcoTank L3150', aliases: [] },
  { id: 21, marca: 'Epson', nombre: 'EcoTank L3110', aliases: [] },
  { id: 22, marca: 'Epson', nombre: 'EcoTank L3250', aliases: [] },
  { id: 23, marca: 'Epson', nombre: 'EcoTank L5190', aliases: [] },
  { id: 24, marca: 'Epson', nombre: 'EcoTank L1110', aliases: [] },
  { id: 30, marca: 'Canon', nombre: 'PIXMA G3110', aliases: [] },
  { id: 31, marca: 'Canon', nombre: 'PIXMA G2110', aliases: [] },
  { id: 32, marca: 'Canon', nombre: 'imageCLASS MF264dw', aliases: [] },
  { id: 33, marca: 'Canon', nombre: 'PIXMA MG2410', aliases: [] },
];

const ids = (q: string) => buscarModelos(q, CATALOGO).coincidencias.map((c) => c.id);

/** Encuentra ESE modelo y ningún otro. */
function soloEste(id: number, variantes: string[]) {
  for (const v of variantes) {
    expect(ids(v), `"${v}"`).toEqual([id]);
  }
}

describe('#38 · normalizarModelo', () => {
  it('minúsculas, sin espacios, guiones, acentos ni puntuación', () => {
    expect(normalizarModelo('HL-L2350DW')).toBe('hll2350dw');
    expect(normalizarModelo('  hl l2350 dw ')).toBe('hll2350dw');
    expect(normalizarModelo('Épson EcoTank L-3150')).toBe('epsonecotankl3150');
    expect(normalizarModelo('CRG.057H / CB435A_x')).toBe('crg057hcb435ax');
    expect(normalizarModelo('')).toBe('');
  });

  it('los códigos de cartucho siguen la misma regla', () => {
    expect(normalizarCodigoCartucho('PG-145 XL')).toBe('pg145xl');
    expect(normalizarCodigoCartucho('TN-227C')).toBe(normalizarCodigoCartucho('tn 227 c'));
  });
});

describe('#38 · Criterio de aceptación: 10 variantes, el modelo correcto y solo ese', () => {
  it('Brother HL-L2350DW, entre la 2370 y la 2395', () => {
    soloEste(1, [
      'HL-L2350DW',
      'hl-l2350dw',
      'hll2350dw',
      'hl l2350dw',
      'HL L2350 DW',
      'hl2350dw',
      'hl2350',
      'l2350dw',
      'brother hl-l2350dw',
      'brother 2350',
    ]);
  });

  it('Epson L3150, entre la L3110 y la L3250', () => {
    soloEste(20, [
      'L3150',
      'l 3150',
      'l-3150',
      'epson l3150',
      'EPSON L3150',
      'ecotank l3150',
      'EcoTank L3150',
      'l3150 ecotank',
      '3150',
      'epson 3150',
    ]);
  });

  it('HP M404dn, entre la M404n y la M404dw', () => {
    soloEste(10, [
      'M404dn',
      'm404 dn',
      'm404-dn',
      'hp m404dn',
      'HP M404DN',
      'laserjet pro m404dn',
      'LaserJet Pro M404dn',
      'lj m404dn',
      'hp laserjet m404dn',
      'pro m404dn',
    ]);
  });
});

describe('#38 · Ambigüedad: se ofrecen todos, no uno al azar', () => {
  it('"m404" son tres modelos: salen los tres', () => {
    expect(ids('m404').sort()).toEqual([10, 11, 12]);
  });

  it('el más parecido va primero: "m404n" antes que el resto', () => {
    expect(ids('m404n')[0]).toBe(11);
  });
});

describe('#38 · Typos: sugerencias, nunca coincidencias', () => {
  it('"hl-l2530dw" (2350 con dos cifras cambiadas) sugiere la HL-L2350DW primero', () => {
    const r = buscarModelos('hl-l2530dw', CATALOGO);
    expect(r.coincidencias).toEqual([]);
    expect(r.sugerencias[0]?.id).toBe(1);
  });

  it('"l3510" sugiere la L3150 primero', () => {
    const r = buscarModelos('l3510', CATALOGO);
    expect(r.coincidencias).toEqual([]);
    expect(r.sugerencias[0]?.id).toBe(20);
  });

  it('"m40dn" (se comió un 4) sugiere la M404dn, aunque el nombre sea largo', () => {
    const r = buscarModelos('m40dn', CATALOGO);
    expect(r.coincidencias).toEqual([]);
    expect(r.sugerencias[0]?.id).toBe(10);
  });

  it('un número distinto NUNCA es coincidencia: "hl-l2360dw" no devuelve la 2350 ni la 2370', () => {
    // Es el caso que vendería el tóner equivocado.
    expect(ids('hl-l2360dw')).toEqual([]);
  });
});

describe('#38 · Aliases', () => {
  it('un alias hace encontrable lo que el nombre no', () => {
    const catalogo = [...CATALOGO, { id: 40, marca: 'HP', nombre: 'LaserJet Pro MFP M428fdw', aliases: ['428'] }];
    expect(buscarModelos('428', catalogo).coincidencias.map((c) => c.id)).toContain(40);
  });
});

describe('#38 · Bordes', () => {
  it('menos de dos caracteres no busca nada', () => {
    expect(buscarModelos('h', CATALOGO)).toEqual({ coincidencias: [], sugerencias: [] });
    expect(buscarModelos(' - ', CATALOGO)).toEqual({ coincidencias: [], sugerencias: [] });
  });

  it('algo que no se parece a nada no devuelve nada', () => {
    expect(buscarModelos('zzqqxx', CATALOGO)).toEqual({ coincidencias: [], sugerencias: [] });
  });

  it('la marca sola no es un modelo: "brother" no afirma ninguna impresora', () => {
    expect(ids('brother')).toEqual([]);
    // Y tampoco cuando el fabricante escribe la marca dentro del nombre, que es
    // cuando de verdad podría coincidir con todos.
    const conMarcaEnNombre = [
      { id: 50, marca: 'Brother', nombre: 'Brother HL-L2350DW', aliases: [] },
      { id: 51, marca: 'Brother', nombre: 'Brother HL-L2370DW', aliases: [] },
    ];
    expect(buscarModelos('brother', conMarcaEnNombre)).toEqual({ coincidencias: [], sugerencias: [] });
    expect(buscarModelos('brother hl2350', conMarcaEnNombre).coincidencias.map((c) => c.id)).toEqual([50]);
  });
});

describe('#38 · distanciaEdicion', () => {
  it('una transposición cuenta como un error', () => {
    expect(distanciaEdicion('2350', '2530')).toBe(1);
    expect(distanciaEdicion('abc', 'abc')).toBe(0);
    expect(distanciaEdicion('', 'abc')).toBe(3);
    expect(distanciaEdicion('m404dn', 'm40dn')).toBe(1);
  });
});
