import type { ListaFabricante } from './importarListasFabricante.js';

/**
 * Impresoras de los cartuchos del top 20 de ventas, copiadas de la web oficial
 * de cada fabricante (#56). Las carga `importar-listas-fabricante`.
 *
 * Reglas para tocar esto:
 *
 * - Solo páginas OFICIALES del fabricante. Ni distribuidores, ni tiendas, ni
 *   «de memoria»: una impresora de más le vende al cliente un cartucho que no le
 *   sirve.
 * - La primera URL es la que acaba en `source_ref`, la que abre quien valida. Si
 *   un modelo solo sale en otra página, va en una lista aparte con ESA página
 *   primero.
 * - Los nombres, como los escribe el fabricante, sin la marca delante.
 *
 * Consultado el 2026-10-01.
 */
export const LISTAS_FABRICANTE: ListaFabricante[] = [
  // ── Epson ──────────────────────────────────────────────────────────────────
  {
    marca: 'Epson',
    cartuchos: ['T544'],
    // Las cuatro botellas (negro, cian, magenta, amarillo) traen la misma lista.
    impresoras: [
      'EcoTank L1110',
      'EcoTank L1210',
      'EcoTank L1250',
      'EcoTank L1350',
      'EcoTank L3110',
      'EcoTank L3150',
      'EcoTank L3160',
      'EcoTank L3210',
      'EcoTank L3250',
      'EcoTank L3251',
      'EcoTank L3260',
      'EcoTank L3310',
      'EcoTank L3350',
      'EcoTank L3351',
      'EcoTank L3352',
      'EcoTank L5190',
      'EcoTank L5290',
      'EcoTank L5590',
    ],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T544-AL/i/T544120-AL',
      'https://epson.com.co/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T544-AL/i/T544120-AL',
    ],
    consultado: '2026-10-01',
  },
  {
    // Solo en la página de Colombia; la de México no la nombra.
    marca: 'Epson',
    cartuchos: ['T544'],
    impresoras: ['EcoTank L3560'],
    fuentes: ['https://epson.com.co/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T544-AL/i/T544120-AL'],
    consultado: '2026-10-01',
  },

  // ── HP ─────────────────────────────────────────────────────────────────────
  {
    // 667 negro y tricolor comparten código de cartucho en el catálogo. La lista
    // modelo a modelo es la de la página del negro (HP Ecuador); la de HP México
    // dice lo mismo por series, para el negro y para el tricolor.
    marca: 'HP',
    cartuchos: ['667'],
    impresoras: [
      'DeskJet 2776',
      'DeskJet 2778',
      'DeskJet Ink Advantage 1200',
      'DeskJet Ink Advantage 2300',
      'DeskJet Ink Advantage 2700',
      'DeskJet Ink Advantage 2775',
      'DeskJet Ink Advantage 2776',
      'DeskJet Ink Advantage 2777',
      'DeskJet Ink Advantage 2778',
      'DeskJet Ink Advantage 2779',
      'DeskJet Ink Advantage 2874',
      'DeskJet Ink Advantage 2875',
      'DeskJet Ink Advantage 2876',
      'DeskJet Ink Advantage 2877',
      'DeskJet Ink Advantage 2878',
      'DeskJet Ink Advantage 2879',
      'DeskJet Ink Advantage 4100',
      'DeskJet Ink Advantage 4175',
      'DeskJet Ink Advantage 4177',
      'DeskJet Ink Advantage 4178',
      'DeskJet Ink Advantage 6075',
      'DeskJet Ink Advantage 6076',
      'DeskJet Ink Advantage 6078',
      'DeskJet Ink Advantage 6400',
    ],
    fuentes: [
      'https://www.hp.com/ec-es/products/ink-toner/product-details/24026936',
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-667-negro-ink-advantage-original-3ym79al.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-667-tricolor-ink-advantage-original-3ym78al.html',
    ],
    consultado: '2026-10-01',
  },
  {
    marca: 'HP',
    cartuchos: ['667XL'],
    impresoras: [
      'DeskJet 2776',
      'DeskJet 2778',
      'DeskJet Ink Advantage 1200',
      'DeskJet Ink Advantage 2300',
      'DeskJet Ink Advantage 2700',
      'DeskJet Ink Advantage 2775',
      'DeskJet Ink Advantage 2776',
      'DeskJet Ink Advantage 2777',
      'DeskJet Ink Advantage 2778',
      'DeskJet Ink Advantage 2779',
      'DeskJet Ink Advantage 2874',
      'DeskJet Ink Advantage 2875',
      'DeskJet Ink Advantage 2876',
      'DeskJet Ink Advantage 2877',
      'DeskJet Ink Advantage 2878',
      'DeskJet Ink Advantage 2879',
      'DeskJet Ink Advantage 4100',
      'DeskJet Ink Advantage 4175',
      'DeskJet Ink Advantage 4177',
      'DeskJet Ink Advantage 4178',
      'DeskJet Ink Advantage 6075',
      'DeskJet Ink Advantage 6076',
      'DeskJet Ink Advantage 6078',
      'DeskJet Ink Advantage 6400',
    ],
    fuentes: [
      'https://www.hp.com/ec-es/products/ink-toner/product-details/24026942',
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-667xl-negro-alto-rendimiento-advantage-original-3ym81al.html',
    ],
    consultado: '2026-10-01',
  },
  {
    // HP publica las familias («funciona con HP Laser 107, 108, 135, 136, 137,
    // 139») y cuatro modelos concretos. Ojo al validar: estas impresoras van
    // bloqueadas por región, y fuera de Latinoamérica usan el 106A; una comprada
    // fuera puede no aceptar el 105A.
    marca: 'HP',
    cartuchos: ['105A', 'W1105A'],
    impresoras: [
      'Laser 107',
      'Laser 107w',
      'Laser 108',
      'Laser 135',
      'Laser MFP 135a',
      'Laser MFP 135ag',
      'Laser MFP 135r',
      'Laser 136',
      'Laser 137',
      'Laser 139',
    ],
    fuentes: [
      'https://www.hp.com/ph-en/products/ink-toner/product-details/25101519',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-105a-negro-laserjet-original-w1105a.html',
    ],
    consultado: '2026-10-01',
  },
  {
    // Páginas de HP para EMEA: no se encontró una latinoamericana. La familia y
    // los cuatro modelos que nombra.
    marca: 'HP',
    cartuchos: ['151A', 'W1510A'],
    impresoras: [
      'LaserJet Pro 4003',
      'LaserJet Pro 4003n',
      'LaserJet Pro MFP 4103',
      'LaserJet Pro MFP 4103dw',
      'LaserJet Pro MFP 4103fdn',
      'LaserJet Pro MFP 4103fdw',
    ],
    fuentes: [
      'https://www.hp.com/emea_africa-en/products/ink-toner/product-details/2100584417',
      'https://www.hp.com/za-en/products/ink-toner/product-details/2100584417',
    ],
    consultado: '2026-10-01',
  },
  {
    marca: 'HP',
    cartuchos: ['954XL'],
    impresoras: [
      'OfficeJet Pro 7740',
      'OfficeJet Pro 8210',
      'OfficeJet Pro 8216',
      'OfficeJet Pro 8218',
      'OfficeJet Pro 8710',
      'OfficeJet Pro 8720',
      'OfficeJet Pro 8730',
      'OfficeJet Pro 8740',
    ],
    fuentes: ['https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-954xl-negra-original-l0s71al.html'],
    consultado: '2026-10-01',
  },

  // ── Canon ──────────────────────────────────────────────────────────────────
  //
  // Canon no publica una página por cartucho: la fuente es la ficha de cada
  // impresora en Canon Latinoamérica, que nombra sus consumibles. Por eso aquí
  // va una entrada por ficha, y quien valida abre la de esa impresora.
  //
  // Fuera a propósito:
  // - PIXMA MG2910: su ficha nombra PG-145 y CL-146, no los XL que vendemos.
  // - PIXMA MX491: no tiene ficha en Canon Latinoamérica.
  // - T03 en imageRUNNER ADVANCE II y DX: solo los nombra Canon Europa, con
  //   nombres de modelo europeos; las versiones latinoamericanas (iF, iFZ) no
  //   aparecen con el tóner en ninguna ficha.
  ...['pixma-ip2810', 'pixma-mg2410', 'pixma-mg2510', 'pixma-mg3010', 'pixma-ts3110'].map(
    (ficha): ListaFabricante => ({
      marca: 'Canon',
      cartuchos: ['PG-145XL', 'CL-146XL'],
      impresoras: [fichaANombre(ficha)],
      fuentes: [`https://www.cla.canon.com/es/p/${ficha}`],
      consultado: '2026-10-01',
    }),
  ),
  ...[
    'imagerunner-advance-525i-iii',
    'imagerunner-advance-525if-iii',
    'imagerunner-advance-615i-iii',
    'imagerunner-advance-615if-iii',
    'imagerunner-advance-715ifz-iii',
    'imagerunner-advance-715iz-iii',
  ].map(
    (ficha): ListaFabricante => ({
      marca: 'Canon',
      cartuchos: ['T03'],
      impresoras: [fichaANombre(ficha)],
      fuentes: [`https://www.cla.canon.com/es/p/${ficha}`],
      consultado: '2026-10-01',
    }),
  ),
  // GI-16 es de la línea MAXIFY GX, no de PIXMA G. Las GX1010 y GX2010 usan GI-25.
  ...['maxify-gx3010', 'maxify-gx4010', 'maxify-gx5010', 'maxify-gx5110', 'maxify-gx6010', 'maxify-gx6110', 'maxify-gx7010', 'maxify-gx7110'].map(
    (ficha): ListaFabricante => ({
      marca: 'Canon',
      cartuchos: ['GI-16'],
      impresoras: [fichaANombre(ficha)],
      fuentes: [`https://www.cla.canon.com/es/p/${ficha}`],
      consultado: '2026-10-01',
    }),
  ),
  // Las G más nuevas (G3180, G4180…) usan GI-21, y las G5010/G6010/G7010, GI-10.
  ...['pixma-g1100', 'pixma-g1110', 'pixma-g2100', 'pixma-g2110', 'pixma-g3100', 'pixma-g3110', 'pixma-g4100', 'pixma-g4110'].map(
    (ficha): ListaFabricante => ({
      marca: 'Canon',
      cartuchos: ['GI-190'],
      impresoras: [fichaANombre(ficha)],
      fuentes: [`https://www.cla.canon.com/es/p/${ficha}`],
      consultado: '2026-10-01',
    }),
  ),
  ...['pixma-g1130', 'pixma-g2160', 'pixma-g2170', 'pixma-g3160', 'pixma-g3170', 'pixma-g4170'].map(
    (ficha): ListaFabricante => ({
      marca: 'Canon',
      cartuchos: ['GI-11'],
      impresoras: [fichaANombre(ficha)],
      fuentes: [`https://www.cla.canon.com/es/p/${ficha}`],
      consultado: '2026-10-01',
    }),
  ),
];

/**
 * "pixma-mg2410" → "PIXMA MG2410"; "imagerunner-advance-715iz-iii" →
 * "imageRUNNER ADVANCE 715iZ III". Es el nombre que da Canon a la ficha, y así
 * la URL y el modelo no pueden desalinearse.
 */
function fichaANombre(ficha: string): string {
  const [familia, ...resto] = ficha.split('-');
  if (familia === 'imagerunner') {
    // "advance-715iz-iii": la serie en mayúsculas, el sufijo de equipamiento como lo escribe Canon.
    const [, modelo, serie] = resto;
    const conSufijo = modelo.replace(/^(\d+)(.*)$/, (_, n: string, s: string) => n + s.replace('z', 'Z').replace('f', 'F'));
    return `imageRUNNER ADVANCE ${conSufijo} ${serie.toUpperCase()}`;
  }
  // La serie iP es la única que Canon escribe con minúscula delante.
  const modelo = resto.join(' ').toUpperCase().replace(/^IP/, 'iP');
  return `${familia.toUpperCase()} ${modelo}`;
}
