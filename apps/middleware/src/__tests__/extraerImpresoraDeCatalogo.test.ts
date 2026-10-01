import { describe, expect, it } from 'vitest';
import { extraerImpresoraDeCatalogo } from '../services/recomendador/extraerImpresoraDeCatalogo.js';

/**
 * #40 · Del nombre de la impresora que vende Supricom a `printer_models`.
 *
 * Todos los nombres son de verdad: los de la categoría IMPRESORA de Odoo el
 * 1-oct-2026, con sus erratas, sus dobles espacios y sus «OPEN BOX».
 */

const de = (nombre: string, referencia: string | null = null) => {
  const r = extraerImpresoraDeCatalogo(nombre, referencia);
  return r.ok ? `${r.impresora.marca} · ${r.impresora.nombre}` : r.motivo;
};
const clave = (nombre: string, referencia: string | null = null) => {
  const r = extraerImpresoraDeCatalogo(nombre, referencia);
  return r.ok ? r.impresora.clave : null;
};

describe('extraerImpresoraDeCatalogo', () => {
  it.each([
    ['CANON IMPRESORA IMAGECLASS MF264DW MULTIFUNCION', 'Canon · imageCLASS MF264DW'],
    ['CANON IMPRESORA IMAGE CLASS MF273dw', 'Canon · imageCLASS MF273DW'],
    ['CANON IMPRESORA IMAGECLASS X MF1538C', 'Canon · imageCLASS X MF1538C'],
    ['CANON MF465DW II - IMPRESORA LASER, MULTIFUNCIONAL, WIFI', 'Canon · MF465DW II'],
    ['CANON 1643I II - IMPRESORA LASER MULTIFUNCIONAL, MONOCROMATICA, ADF, WIFI', 'Canon · 1643I II'],
    ['CANON DX 529iF - IMPRESORA LASER MULTIFUNCIONAL, MONOCROMATICA', 'Canon · DX 529IF'],
    ['IMPRESORA CANON IR 1643IF II no incluye el toner ', 'Canon · IR 1643IF II'],
    ['CANON IMPRESORA IPROGRAF TC-20 PLOTTER', 'Canon · imagePROGRAF TC-20'],
    ['CANON IMPRESORA MF272DW 110-127V US ', 'Canon · MF272DW'],
    ['Canon IMPRERORA ImageCLASS LBP6230DW - WIRELESS', 'Canon · imageCLASS LBP6230DW'],
    ['HP IMPRESORA COLOR LASERJET PRO MFP 4303FDW', 'HP · Color LaserJet Pro MFP 4303FDW'],
    ['HP IMPRESORA LASERJET PRO MFP M428FDW', 'HP · LaserJet Pro MFP M428FDW'],
    ['IMPRESORA HP MULTIFUNCIONAL SMART TANK 580 W', 'HP · Smart Tank 580'],
    ['HP SMART TANK 583, IMPRESORA MULTIFUNCIONAL', 'HP · Smart Tank 583'],
    ['HP IMPRESORA 2875 ', 'HP · 2875'],
    ['HP IMPRESORA DESIGNJET T650 PRINTER 36 IN', 'HP · DesignJet T650'],
    ['IMPRESORA HP LASERTJET MFP M236sdw', 'HP · LaserJet MFP M236SDW'],
    ['IMPRESORA HP DESKJET INK ADVANTAGE 2135', 'HP · DeskJet Ink Advantage 2135'],
    ['HP IMPRESORA PRINTER 415  /IMPRESION,COPIA,ESCANEA/WIRELES/IMPRIME', 'HP · 415'],
    ['EPSON IMPRESORA ECOTANK L4360 PT338EPS39 ', 'Epson · EcoTank L4360'],
    ['IMPRESORA EPSON ECOTAND L3210', 'Epson · EcoTank L3210'],
    ['EPSON IMPRESORA L3250 A/O 110V  (LATIN, E/E UGK) RMA ', 'Epson · L3250'],
    ['EPSON IMPRESORA L8180.', 'Epson · L8180'],
    ['EPSON IMPRESORA FX-890 II MATRICIAL', 'Epson · FX-890 II'],
    ['EPSON SURECOLOR  T3170 PRINTER 24´´', 'Epson · SureColor T3170'],
    ['EPSON T3170M - IMPRESORA Y ESCANER DE FORMATO ANCHO, 24"  ', 'Epson · T3170M'],
    ['XEROX IMPRESORA MULTIFUNCIONAL  B235 MFP 110V', 'Xerox · B235'],
  ])('%s → %s', (nombre, esperado) => {
    expect(de(nombre)).toBe(esperado);
  });

  it('Brother: la familia sale de la referencia cuando el nombre se la come', () => {
    expect(de('BROTHER IMPRESORA PRINTER MONOCROMATICA 2750DW LASER WITH WIRELESS AND DUPLEX', 'HLL2750DW')).toBe('Brother · HL-L2750DW');
    expect(de('BROTHER IMPRESORA PRINTER L5900DW  MONOCROMATICA  LASER OPEN BOX', 'MFC-L5900DW-1')).toBe('Brother · MFC-L5900DW');
    expect(de('BROTHER T420W- IMPRESORA DE TINTA MULTIFUNCIONAL, WIFI', 'DCPT420W')).toBe('Brother · DCP-T420W');
    // Referencia que no dice nada («5700DW-OB»): vale el nombre.
    expect(de('BROTHER IMPRESORA LASER MULTIFUNCION MFCL5700DW (OPEN BOX) ', '5700DW-OB')).toBe('Brother · MFC-L5700DW');
    expect(de('BROTHER DCP-T530DW- IMPRESORA DE TINTA MULTIFUNCIONAL WIFI', 'DCPT530DW')).toBe('Brother · DCP-T530DW');
  });

  it('el mismo modelo con otra familia, u otro nombre, da la misma clave', () => {
    expect(clave('CANON IMPRESORA PIXMA G4170 -  MULTIFUNCIONAL, T. TINTA, WIFI')).toBe(clave('CANON IMPRESORA G4170'));
    expect(clave('CANON TS3610 - IMPRESORA DE TINTA MULTIFUNCIONAL')).toBe(clave('CANON IMPRESORA PIXMA TS3610 MULTIFUNCIONAL'));
    expect(clave('CANON IMPRESORA LASER WIRELESS DUPLEX WHITE MF465DWII')).toBe(clave('CANON MF465DW II - IMPRESORA MULTIFUNCIONAL'));
    expect(clave('BROTHER HLL2379DW - IMPRESORA LASER MONOCROMATICA', 'HLL-2379DW')).toBe(
      clave('BROTHER IMPRESORA LASER MONOCROMATICA HL-L2379DW ', 'HLL2379DW'),
    );
  });

  it('un modelo que son solo cifras se identifica con la familia: el 580 de HP no es cualquier 580', () => {
    expect(clave('HP IMPRESORA SMART TANK 520')).toBe('smarttank520');
    expect(clave('HP IMPRESORA LASERJET PRO M203DW')).toBe('m203dw');
  });

  it.each([
    ['BROTHER ADS1250W - ESCANER COMPACTO, WIFI', 'no_es_impresora'],
    ['CANON LIDE 300 - ESCANER CAMA PLANA', 'no_es_impresora'],
    ['CANON BANDEJA UNIT AR1', 'no_es_impresora'],
    ['CANON C. FEEDING U.-AW1 ', 'no_es_impresora'],
    ['CANON WIRELESS LAN BOARD-D1', 'no_es_impresora'],
    ['BROTHER PTH110 - MAQUINA ETIQUETADORA', 'no_es_impresora'],
    ['BROTHER TN227 - TONER MAGENTA', 'no_es_impresora'],
    // Térmicas y de etiquetas: no llevan tóner.
    ['SAT IMPRESORA TERMICA 58 mm  SAT-15T2U', 'sin_marca'],
    ['UTILITY TRAY-B1 ', 'no_es_impresora'],
  ])('descarta %s (%s)', (nombre, motivo) => {
    expect(de(nombre)).toBe(motivo);
  });

  it('«no incluye toner» no lo convierte en un tóner', () => {
    expect(de('CANON IMPRESORA IR1643I II NO INCLUYE TONER ')).toBe('Canon · IR1643I II');
  });
});
