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
  {
    // El CF258A es el que más factura de los tres que faltaban (35.054 en 12
    // meses) y el único del top 20 que ya tenía impresoras por el nombre de un
    // producto: las del ASTA TONER CF258, que es OTRO cartucho. Este las ata al
    // código que el top 20 usa de verdad.
    //
    // La página de HP Venezuela nombra solo familias —«LaserJet Enterprise M406,
    // M430; LaserJet Pro M404, M428»—, así que los modelos salen de la lista de
    // impresoras compatibles de la tienda de HP, que es la que se abre al
    // validar. Las «Certified Refurbished» que esa lista repite son el mismo
    // modelo y no entran. La M428dw tampoco: la familia la incluye, pero la
    // lista de modelos no la nombra, y aquí no se completa lo que la página
    // calla.
    marca: 'HP',
    cartuchos: ['CF258A'],
    impresoras: [
      'LaserJet Enterprise M406dn',
      'LaserJet Enterprise MFP M430f',
      'LaserJet Pro M404dn',
      'LaserJet Pro M404dw',
      'LaserJet Pro M404n',
      'LaserJet Pro MFP M428fdn',
      'LaserJet Pro MFP M428fdw',
    ],
    fuentes: [
      'https://www.hp.com/us-en/shop/pdp/hp-58a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ve-es/products/ink-toner/product-details/21869329',
    ],
    consultado: '2026-10-02',
  },
  {
    // El 150A es el cartucho del «ASTA TONER HP W1500A», que es como lo llama
    // nuestro catálogo; por eso van los dos códigos.
    //
    // HP nombra cuatro modelos concretos y, además, dos RANGOS: «M109-M112» y
    // «M139e-M142e». Los rangos no se enumeran: escribir aquí una M110 o una
    // M140e sería meter impresoras que la página no dice. Si aparece un cliente
    // con una de ellas, se añade a mano al validar.
    marca: 'HP',
    cartuchos: ['W1500A', '150A'],
    impresoras: ['LaserJet M111cw', 'LaserJet MFP M141a', 'LaserJet MFP M141ca', 'LaserJet MFP M141cw'],
    fuentes: ['https://www.hp.com/emea_middle_east-en/products/ink-toner/product-details/35832657'],
    consultado: '2026-10-02',
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
  // ── El segundo tramo: lo que más pesa después del top 20 ──────────────────
  //
  // Medido el 2026-10-05 sobre el top 60 de ventas, ya pasados los importadores:
  // estos cartuchos tienen producto y NINGUNA impresora. Van por orden de peso.
  //
  // Fuera de esta tanda, y por qué:
  //   · GT53 y GT52 (28.311 juntos): HP solo publica SERIES —«Smart Tank serie
  //     510», «Plus serie 550»—, y aquí los rangos no se enumeran.
  //   · Canon T06 (33.273), T10, GPR-58, 067H, BH-1/CH-1: la web de Canon
  //     Latinoamérica no nombra el consumible en la ficha de la impresora, y la
  //     página del cartucho en Canon USA no existe para estos. Hace falta otra
  //     vuelta.
  {
    marca: 'HP',
    cartuchos: ['664'],
    impresoras: [
      'DeskJet Ink Advantage 1115',
      'DeskJet Ink Advantage 2135',
      'DeskJet Ink Advantage 2675',
      'DeskJet Ink Advantage 3635',
      'DeskJet Ink Advantage 3775',
      'DeskJet Ink Advantage 3787',
      'DeskJet Ink Advantage 3835',
      'DeskJet Ink Advantage 4675',
    ],
    fuentes: ['https://www.hp.com/ve-es/products/ink-toner/product-details/7907798'],
    consultado: '2026-10-05',
  },
  {
    // Los cuatro colores del 230A llevan la misma lista: comprobado en la página
    // del negro y en la del cian, que coinciden modelo a modelo.
    marca: 'HP',
    cartuchos: ['230A', 'W2300A', 'W2301A', 'W2302A', 'W2303A'],
    impresoras: [
      'Color LaserJet Pro 4203cdn',
      'Color LaserJet Pro 4203dn',
      'Color LaserJet Pro 4203dw',
      'Color LaserJet Pro MFP 4303dw',
      'Color LaserJet Pro MFP 4303fdn',
      'Color LaserJet Pro MFP 4303fdw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-230a-laserjet-negro-original-w2300a.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-230a-laserjet-cian-original-w2301a.html',
    ],
    consultado: '2026-10-05',
  },
  {
    // El 151X es el de alto rendimiento del 151A: misma lista, y por eso las dos
    // entradas apuntan a las mismas impresoras y no se duplica ninguna.
    marca: 'HP',
    cartuchos: ['151X', 'W1510X'],
    impresoras: [
      'LaserJet Pro 4003',
      'LaserJet Pro 4003n',
      'LaserJet Pro MFP 4103',
      'LaserJet Pro MFP 4103dw',
      'LaserJet Pro MFP 4103fdn',
      'LaserJet Pro MFP 4103fdw',
    ],
    fuentes: ['https://www.hp.com/emea_africa-en/products/ink-toner/product-details/2100584418'],
    consultado: '2026-10-05',
  },
  {
    // El 58X es el de alto rendimiento del 58A, y la tienda de HP le da los
    // mismos siete modelos, uno a uno.
    marca: 'HP',
    cartuchos: ['CF258X', '58X'],
    impresoras: [
      'LaserJet Enterprise M406dn',
      'LaserJet Enterprise MFP M430f',
      'LaserJet Pro M404dn',
      'LaserJet Pro M404dw',
      'LaserJet Pro M404n',
      'LaserJet Pro MFP M428fdn',
      'LaserJet Pro MFP M428fdw',
    ],
    fuentes: ['https://www.hp.com/us-en/shop/pdp/hp-58x-high-yield-black-original-laserjet-toner-cartridge'],
    consultado: '2026-10-05',
  },
  {
    // La página de HP Venezuela y la de México solo dan familias («serie M454»,
    // «M479»); los cuatro modelos salen de la lista de compatibles de la tienda
    // de HP, que es la que queda en `source_ref`.
    marca: 'HP',
    cartuchos: ['414A', 'W2020A'],
    impresoras: [
      'Color LaserJet Enterprise M455dn',
      'Color LaserJet Enterprise MFP M480f',
      'Color LaserJet Pro MFP M479fdn',
      'Color LaserJet Pro MFP M479fdw',
    ],
    fuentes: [
      'https://www.hp.com/us-en/shop/pdp/hp-414a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ve-es/products/ink-toner/product-details/21959550',
    ],
    consultado: '2026-10-05',
  },

  {
    // El 125 rompe la regla de arriba —una entrada por ficha de impresora—
    // porque aquí Canon sí publica la página del cartucho, y las fichas de estas
    // impresoras en Canon Latinoamérica **no nombran su consumible**: se
    // comprobó la de la LBP6030w y no dice 125 por ninguna parte. La fuente es
    // la tienda de Canon, que lo dice en una línea: «For use with MF3010,
    // MF3010 VP, LBP6000, LBP6030w».
    //
    // La «MF3010 VP» queda fuera: es el paquete con tóner incluido, la misma
    // impresora. Meterla duplicaría un equipo en el kiosco.
    marca: 'Canon',
    cartuchos: ['125'],
    impresoras: ['imageCLASS LBP6000', 'imageCLASS LBP6030w', 'imageCLASS MF3010'],
    fuentes: ['https://www.usa.canon.com/shop/p/125-black-toner-cartridge'],
    consultado: '2026-10-02',
  },

  // ── El tercer tramo: impresoras que vende Supricom y no tenían tóner ───────
  //
  // Medido el 2026-10-06: de las impresoras del catálogo de Odoo, 81 de marcas
  // de las que vendemos consumibles no tenían ninguno. Se buscó cada una en la
  // web oficial de su fabricante y solo entra lo que se pudo leer allí, con el
  // código de un consumible que vendemos. Las impresoras van con el nombre EXACTO
  // de nuestro catálogo («L4260», «MF272DW»), para que enlacen con la que se
  // vende y no creen otra; las que no vendemos pero salen en la misma página, con
  // el nombre del fabricante.
  //
  // Fuera, a propósito: las de tinta de Brother (solo vendemos su tóner), la
  // «HL-L2750DW» (no existe en Brother: ¿MFC-L2750DW?), la HP 9730 (según el
  // país, 937 o 938), la «M227FNDW» (HP no tiene ese modelo), la PIXMA TS3610
  // (sin página oficial con sus cartuchos), la SELPHY y las Epson cuyos
  // consumibles no vendemos (T534, T524, T574, cintas, XD3).
  {
    marca: 'Brother',
    cartuchos: ['TN-760'],
    impresoras: ['HL-L2350DW'],
    fuentes: [
      'https://www.brother-usa.com/products/tn760',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Brother',
    cartuchos: ['TN-730'],
    impresoras: ['HL-L2350DW'],
    fuentes: [
      'https://www.brother-usa.com/products/tn730',
    ],
    consultado: '2026-10-06',
  },
  // La HL-L2379DW no sale en las páginas del tóner: su lista de consumibles está en soporte.
  {
    marca: 'Brother',
    cartuchos: ['TN-760', 'TN-730'],
    impresoras: ['HL-L2379DW'],
    fuentes: [
      'https://support.brother.com/g/b/colist.aspx?c=us&lang=en&prod=hll2379dw_us&cao=tn',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Brother',
    cartuchos: ['TN-820'],
    impresoras: ['MFC-L5700DW', 'MFC-L5705DW', 'MFC-L5900DW'],
    fuentes: [
      'https://www.brother-usa.com/products/tn820',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Brother',
    cartuchos: ['TN-850'],
    impresoras: ['MFC-L5700DW', 'MFC-L5705DW', 'MFC-L5900DW'],
    fuentes: [
      'https://www.brother-usa.com/products/tn850',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Brother',
    cartuchos: ['DR-820'],
    impresoras: ['MFC-L5700DW', 'MFC-L5705DW', 'MFC-L5900DW'],
    fuentes: [
      'https://www.brother-usa.com/products/dr820',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Brother',
    cartuchos: ['TN-920XL'],
    impresoras: ['HL-L5215DW'],
    fuentes: [
      'https://www.brother-usa.com/products/tn920xl',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Brother',
    cartuchos: ['TN-920UXXL'],
    impresoras: ['HL-L5215DW'],
    fuentes: [
      'https://www.brother-usa.com/products/tn920uxxl',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T504'],
    impresoras: ['L4260', 'EcoTank L4360', 'EcoTank L6270', 'EcoTank L6370', 'EcoTank L14150', 'EcoTank L4160', 'EcoTank L6191'],
    fuentes: [
      'https://epson.com.co/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-504/i/T504',
      'https://epson.com.mx/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T504/i/T504220-AL',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T554'],
    impresoras: ['L8180'],
    fuentes: [
      'https://epson.com.co/Para-el-hogar/Tintas/Epson-T554/i/T554',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T555'],
    impresoras: ['L8180'],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Tintas-Epson-T555/i/T555120-AL',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T49M'],
    impresoras: ['SureColor F170', 'SureColor F570'],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T49M/i/T49M120',
      'https://epson.com/For-Home/Ink/Epson-T49M-Ink-Bottles/i/T49M',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T49H'],
    impresoras: ['SureColor T3170X'],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T49H/i/T49H100',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T40W'],
    impresoras: ['SureColor T3170', 'T3170M', 'T5170', 'SureColor T5170M'],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Tintas-Epson-UltraChrome-XD2-de-Alta-Capacidad/i/T40W120',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Epson',
    cartuchos: ['T11A'],
    impresoras: ['WorkForce Pro C5390'],
    fuentes: [
      'https://epson.com.ar/Para-el-hogar/Tintas/Tintas-T11A/i/T11A',
      'https://epson.com.br/Para-casa/Tintas/Tintas-T11A/i/T11A',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['105A', 'W1105A'],
    impresoras: ['135W', '137FNW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laser-135w-4zb83a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncion-hp-laser-137fnw-4zb84a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['150A', 'W1500A'],
    impresoras: ['LaserJet M111W', 'M141W'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-m111w-7md68a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-m141w-7md74a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['151A', 'W1510A'],
    impresoras: ['LaserJet MFP 4103DW', 'LaserJet MFP 4103FDW', 'LaserJet Pro 4003DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-pro-mfp-4103fdw-2z629a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-pro-mfp-4103dw-2z627a.html',
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-4003dw-2z610a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['151X', 'W1510X'],
    impresoras: ['LaserJet MFP 4103DW', 'LaserJet MFP 4103FDW', 'LaserJet Pro 4003DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-pro-mfp-4103fdw-2z629a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-pro-mfp-4103dw-2z627a.html',
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-4003dw-2z610a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['145A', 'W1450A'],
    impresoras: ['LaserJet Pro 3003DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-3003dw-3g654a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['145X', 'W1450X'],
    impresoras: ['LaserJet Pro 3003DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-3003dw-3g654a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['30A', 'CF230A'],
    impresoras: ['LaserJet Pro M203DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-m203dw-g3q47a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['30X', 'CF230X'],
    impresoras: ['LaserJet Pro M203DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-m203dw-g3q47a.html',
    ],
    consultado: '2026-10-06',
  },
  // El tambor de la M203dw.
  {
    marca: 'HP',
    cartuchos: ['32A', 'CF232A'],
    impresoras: ['LaserJet Pro M203DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-hp-laserjet-pro-m203dw-g3q47a.html',
    ],
    consultado: '2026-10-06',
  },
  // Los cuatro colores del 414A y del 414X; la página dice «solo para América».
  {
    marca: 'HP',
    cartuchos: ['414A', 'W2020A', 'W2021A', 'W2022A', 'W2023A'],
    impresoras: ['LaserJet Pro M479DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-pro-m479dw-w1a77a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['414X', 'W2020X', 'W2021X', 'W2022X', 'W2023X'],
    impresoras: ['LaserJet Pro M479DW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-pro-m479dw-w1a77a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['136A', 'W1360A'],
    impresoras: ['LaserJet MFP M236SDW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-laserjet-m236sdw-9yg09a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['222A', 'W2220A', 'W2221A', 'W2222A', 'W2223A'],
    impresoras: ['Color LaserJet Pro MFP M3303FDW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/hp-color-laserjet-pro-mfp-3303fdw-499m8a.html',
    ],
    consultado: '2026-10-06',
  },
  // Cada Smart Tank lista sus botellas en su propia ficha: una fuente por impresora.
  {
    marca: 'HP',
    cartuchos: ['GT53'],
    impresoras: ['Smart Tank 519', 'Smart Tank 520', 'Smart Tank 523', 'Smart Tank 530', 'Smart Tank 580', 'Smart Tank 581', 'Smart Tank 583', 'Smart Tank 720', 'Smart Tank 750', 'Smart Tank 790'],
    fuentes: [
      'https://www.hp.com/cl-es/shop/impresora-multifuncional-hp-smart-tank-519-3yw73a.html',
      'https://www.hp.com/cl-es/shop/impresora-multifuncional-hp-smart-tank-520-1f3w2a.html',
      'https://www.hp.com/mx-es/shop/impresora-todo-en-uno-hp-smart-tank-523-4a8s2a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-530-4sb24a.html',
      'https://www.hp.com/cl-es/shop/impresora-multifuncional-hp-smart-tank-580-tinta-continua-color-wi-fi-smart-app-escaner-1f3y2a.html',
      'https://www.hp.com/py-es/products/printers/product-details/product-specifications/2101280821',
      'https://www.hp.com/ec-es/products/printers/product-details/product-specifications/2101280824',
      'https://www.hp.com/cl-es/shop/impresora-multifuncion-hp-smart-tank-720-6uu46a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-750-6uu47a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-790-4wf66a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['GT52'],
    impresoras: ['Smart Tank 519', 'Smart Tank 520', 'Smart Tank 523', 'Smart Tank 530', 'Smart Tank 580', 'Smart Tank 581', 'Smart Tank 583', 'Smart Tank 720', 'Smart Tank 750', 'Smart Tank 790'],
    fuentes: [
      'https://www.hp.com/cl-es/shop/impresora-multifuncional-hp-smart-tank-519-3yw73a.html',
      'https://www.hp.com/cl-es/shop/impresora-multifuncional-hp-smart-tank-520-1f3w2a.html',
      'https://www.hp.com/mx-es/shop/impresora-todo-en-uno-hp-smart-tank-523-4a8s2a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-530-4sb24a.html',
      'https://www.hp.com/cl-es/shop/impresora-multifuncional-hp-smart-tank-580-tinta-continua-color-wi-fi-smart-app-escaner-1f3y2a.html',
      'https://www.hp.com/py-es/products/printers/product-details/product-specifications/2101280821',
      'https://www.hp.com/ec-es/products/printers/product-details/product-specifications/2101280824',
      'https://www.hp.com/cl-es/shop/impresora-multifuncion-hp-smart-tank-720-6uu46a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-750-6uu47a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-790-4wf66a.html',
    ],
    consultado: '2026-10-06',
  },
  // «415» del catálogo: la Ink Tank Wireless 415.
  {
    marca: 'HP',
    cartuchos: ['GT51', 'GT52'],
    impresoras: ['415'],
    fuentes: [
      'https://www.hp.com/ec-es/products/printers/product-details/product-specifications/22324256',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['GT51'],
    impresoras: ['Smart Tank 530', 'Smart Tank 750'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-530-4sb24a.html',
      'https://www.hp.com/mx-es/shop/impresora-multifuncional-hp-smart-tank-750-6uu47a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['667', '667XL'],
    impresoras: ['DeskJet Ink Advantage 2375'],
    fuentes: [
      'https://www.hp.com/py-es/products/printers/product-details/product-specifications/33691578',
    ],
    consultado: '2026-10-06',
  },
  // «2975» del catálogo: la DeskJet Ink Advantage 2975.
  {
    marca: 'HP',
    cartuchos: ['668', '668XL'],
    impresoras: ['2975'],
    fuentes: [
      'https://www.hp.com/uy-es/products/printers/product-details/product-specifications/2102771898',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['712'],
    impresoras: ['DesignJet T210', 'DesignJet T250', 'DesignJet T650'],
    fuentes: [
      'https://www.hp.com/gb-en/shop/products/supplies/hp-712-80-ml-black-designjet-ink-cartridge-3ed71a',
      'https://www.hp.com/sa-en/products/ink-toner/product-details/34386185',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'HP',
    cartuchos: ['738'],
    impresoras: ['DesignJet T850'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-designjet-hp-738-de-130-ml-negro-498n4a.html',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['051H'],
    impresoras: ['imageCLASS MF264DW', 'MF267DW II'],
    fuentes: [
      'https://www.usa.canon.com/shop/p/051-black-toner-cartridge-high-capacity',
      'https://shop.canon.ca/en_ca/p/051-black-toner-cartridge-high-capacity',
    ],
    consultado: '2026-10-06',
  },
  // El 051 que vendemos es el TAMBOR; el tóner es el 051H.
  {
    marca: 'Canon',
    cartuchos: ['051'],
    impresoras: ['imageCLASS MF264DW', 'MF267DW II'],
    fuentes: [
      'https://www.usa.canon.com/shop/p/051-black-drum-cartridge',
      'https://www.canon.cl/productos/toner/drum-cartridge-051',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['071H'],
    impresoras: ['MF272DW', 'imageCLASS MF273DW'],
    fuentes: [
      'https://shop.canon.ca/en_ca/p/071-noir-toner-cartridge-high-capacity',
      'https://www.usa.canon.com/shop/p/071-black-toner-cartridge-high-capacity',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['070', '070H'],
    impresoras: ['MF462DW', 'imageCLASS MF465DW'],
    fuentes: [
      'https://shop.canon.ca/en_ca/p/070-black-toner-cartridge',
      'https://www.usa.canon.com/shop/p/070-black-toner-cartridge-high-capacity',
    ],
    consultado: '2026-10-06',
  },
  // La página de Canadá del 070 no nombra la MF465dw II; la de la impresora, sí.
  {
    marca: 'Canon',
    cartuchos: ['070', '070H'],
    impresoras: ['MF465DW II'],
    fuentes: [
      'https://www.usa.canon.com/shop/p/imageclass-mf465dw-ii-all-in-one-wireless-duplex-laser-printer',
      'https://www.usa.canon.com/shop/p/070-black-toner-cartridge',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['057', '057H'],
    impresoras: ['MF455DW'],
    fuentes: [
      'https://www.canon.ca/en/product?name=imageCLASS_MF455dw',
      'https://shop.canon.ca/en_ca/p/057-black-toner-cartridge',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['067', '067H'],
    impresoras: ['MF656CDW'],
    fuentes: [
      'https://shop.canon.ca/en_ca/p/067-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/067-toner-cartridge-high-capacity',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['075', '075H'],
    impresoras: ['MF663CDW', 'MF665CDW'],
    fuentes: [
      'https://www.usa.canon.com/shop/p/toner-075',
      'https://www.usa.canon.com/shop/p/toner-075-high-capacity',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['055', '055H'],
    impresoras: ['LBP664CDW'],
    fuentes: [
      'https://shop.canon.ca/en_ca/p/055-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/055-toner-cartridge-high-capacity',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['126'],
    impresoras: ['imageCLASS LBP6230DW'],
    fuentes: [
      'https://www.usa.canon.com/shop/p/126-black-toner-cartridge',
    ],
    consultado: '2026-10-06',
  },
  // Toda la familia 1643 (1643P, i, i II, iF, iF II y las imageCLASS X) usa el T06: por eso entran también los nombres del catálogo que no dicen cuál es.
  {
    marca: 'Canon',
    cartuchos: ['T06'],
    impresoras: ['1643I II', 'IR1643I II', 'IR1643I', 'IF 1643F', 'IR 1643IF II', 'MF1643'],
    fuentes: [
      'https://www.canon.cl/productos/toner/toner-t06-black',
      'https://www.usa.canon.com/shop/p/imageclass-x-mf1643i-ii',
      'https://www.usa.canon.com/shop/p/imageclass-x-mf1643if-ii',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['T08'],
    impresoras: ['imageCLASS X MF1238 II'],
    fuentes: [
      'https://shop.canon.ca/en_ca/imageclass-x-mf1238-ii',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['T10'],
    impresoras: ['imageCLASS X MF1538C'],
    fuentes: [
      'https://www.canon.ca/en/product?name=Colour_imageCLASS_X_MF1538C',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['T03'],
    impresoras: ['DX 529IF'],
    fuentes: [
      'https://www.canon.ca/en/product?name=imageRUNNER_ADVANCE_DX_529iF',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['GPR-66'],
    impresoras: ['imageRUNNER C3326I'],
    fuentes: [
      'https://www.canon.ca/dam/Brochures/BICG/EN/imageRUNNER-C3326i-Brochure-ENG.pdf',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['PFI-050'],
    impresoras: ['imagePROGRAF TC-20', 'TC-21M'],
    fuentes: [
      'https://shop.canon.ca/en_ca/p/pfi-050-bk-pigment-black-ink-tank',
      'https://shop.canon.ca/en_ca/p/pfi-050-c-pigment-cyan-ink-tank',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['PFI-030', 'PFI-031'],
    impresoras: ['TM-340'],
    fuentes: [
      'https://lfp.canon.ca/product/imageprograf-tm-340/',
    ],
    consultado: '2026-10-06',
  },
  {
    marca: 'Canon',
    cartuchos: ['PG-44', 'CL-54XL'],
    impresoras: ['PIXMA E4210'],
    fuentes: [
      'https://www.cla.canon.com/es/p/pixma-e4210',
    ],
    consultado: '2026-10-06',
  },

  // ── El cuarto tramo: los cartuchos del top 100 que no tenían impresoras ────
  //
  // Medido el 2026-10-07 sobre los 100 productos más vendidos: los que tenían su
  // cartucho validado pero ninguna impresora. Las páginas LatAm de HP solo dan
  // la SERIE de los láser («serie M402»): entra el nombre de la serie, que el
  // buscador encuentra por su número, y los modelos concretos que nombra la
  // tienda oficial de HP Canadá. Fuera: HP 105X (no existe en hp.com), el tambor
  // GPR-58 (sin página oficial legible) y la M283fdw del 206A (fuera del texto
  // de la serie).
  // Los cuatro colores del 202A nombran las mismas series.
  {
    marca: 'HP',
    cartuchos: ['202A', 'CF500A', 'CF501A', 'CF502A', 'CF503A'],
    impresoras: [
      'Color LaserJet Pro M254',
      'Color LaserJet Pro MFP M280',
      'Color LaserJet Pro M254dw',
      'Color LaserJet Pro MFP M281fdw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-202a-negro-laserjet-original-cf500a.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-202a-cian-laserjet-original-cf501a.html',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-202a-black-original-laserjet-toner-cartridge-cf500a',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'HP',
    cartuchos: ['206A', 'W2110A', 'W2111A', 'W2112A', 'W2113A'],
    impresoras: [
      'Color LaserJet Pro M255',
      'Color LaserJet Pro MFP M282',
      'Color LaserJet Pro M255dn',
      'Color LaserJet Pro M255dw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-original-hp-206a-laserjet-negro-w2110a.html',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-206a-black-original-laserjet-toner-cartridge-w2110a',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'HP',
    cartuchos: ['215A', 'W2310A', 'W2311A', 'W2312A', 'W2313A'],
    impresoras: [
      'Color LaserJet Pro M155',
      'Color LaserJet Pro MFP M182',
      'Color LaserJet Pro MFP M183',
      'Color LaserJet Pro MFP M182nw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-215a-negro-laserjet-original-w2310a.html',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-215a-black-original-laserjet-toner-cartridge-w2310a',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'HP',
    cartuchos: ['89A', 'CF289A'],
    impresoras: [
      'LaserJet Enterprise M507',
      'LaserJet Enterprise MFP M528',
      'LaserJet Enterprise M507dn',
      'LaserJet Enterprise M507dng',
      'LaserJet Enterprise M507n',
      'LaserJet Enterprise M507x',
      'LaserJet Enterprise MFP M528dn',
      'LaserJet Enterprise MFP M528f',
      'LaserJet Enterprise Flow MFP M528c',
      'LaserJet Enterprise Flow MFP M528z',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-89a-negro-laserjet-original-cf289a.html',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-89a-black-original-laserjet-toner-cartridge-cf289a',
    ],
    consultado: '2026-10-07',
  },
  // El 26A y el 26X nombran las mismas impresoras.
  {
    marca: 'HP',
    cartuchos: ['26A', 'CF226A', '26X', 'CF226X'],
    impresoras: [
      'LaserJet Pro M402',
      'LaserJet Pro MFP M426',
      'LaserJet Pro M402dn',
      'LaserJet Pro M402dw',
      'LaserJet Pro M402n',
      'LaserJet Pro MFP M426fdn',
      'LaserJet Pro MFP M426fdw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-26a-negro-laserjet-original-cf226a.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-26x-negro-alto-rendimiento-laserjet-original-cf226x.html',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-26a-black-original-laserjet-toner-cartridge-cf226a',
    ],
    consultado: '2026-10-07',
  },
  // Las ocho piezas (954 y 954XL, cuatro colores) traen la misma lista.
  {
    marca: 'HP',
    cartuchos: ['954', '954XL'],
    impresoras: [
      'OfficeJet Pro 8210',
      'OfficeJet Pro 8216',
      'OfficeJet Pro 8218',
      'OfficeJet Pro 7740',
      'OfficeJet Pro 8710',
      'OfficeJet Pro 8720',
      'OfficeJet Pro 8730',
      'OfficeJet Pro 8740',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-954-cian-original-l0s50al.html',
      'https://www.hp.com/cl-es/shop/cartucho-de-tinta-hp-954-negra-original-l0s59al.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-954xl-negra-original-l0s71al.html',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'HP',
    cartuchos: ['664', '664XL'],
    impresoras: [
      'DeskJet 1110',
      'DeskJet 1115',
      'DeskJet 2130',
      'DeskJet 2135',
      'DeskJet 3630',
      'ENVY 4520',
      'OfficeJet 3830',
    ],
    fuentes: [
      'https://www.hp.com/cl-es/shop/cartucho-de-tinta-hp-664xl-negra-original-f6v31al.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-664-negra-original-f6v29al.html',
    ],
    consultado: '2026-10-07',
  },
  // Con el nombre de HP, no el «9730» del catálogo: según el país la 9730 usa el 937, y la nuestra no está confirmada.
  {
    marca: 'HP',
    cartuchos: ['938'],
    impresoras: [
      'OfficeJet Pro 9110',
      'OfficeJet Pro 9120',
      'OfficeJet Pro 9130',
      'OfficeJet Pro 9720',
      'OfficeJet Pro 9730',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-original-de-tinta-negra-hp-938-4s6x8pl.html',
    ],
    consultado: '2026-10-07',
  },
  // Canon solo publica la lista del 14x en Brasil: confirmada, quizá no completa.
  {
    marca: 'Canon',
    cartuchos: ['PG-145', 'PG-145XL'],
    impresoras: [
      'PIXMA MG2410',
      'PIXMA MG2510',
      'PIXMA MG2910',
      'PIXMA MG3010',
      'PIXMA TS3110',
    ],
    fuentes: [
      'https://www.canon.com.br/produtos/produtos-para-voce---impressoras---linha-de-cartuchos/cartucho-de-tinta-pg-145-bk',
      'https://www.canon.com.br/produtos/produtos-para-voce---impressoras---linha-de-cartuchos/cartucho-de-tinta-pg-145-bk-xl',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'Canon',
    cartuchos: ['CL-146', 'CL-146XL'],
    impresoras: [
      'PIXMA MG2410',
      'PIXMA MG2510',
      'PIXMA MG2910',
      'PIXMA MG3010',
      'PIXMA TS3110',
    ],
    fuentes: [
      'https://www.canon.com.br/produtos/produtos-para-voce---impressoras---linha-de-cartuchos/cartucho-de-tinta-cl-146-col',
      'https://www.canon.com.br/produtos/produtos-para-voce---impressoras---linha-de-cartuchos/cartucho-de-tinta-cl-146-col-xl',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'Canon',
    cartuchos: ['PG-140XL', 'PG-140'],
    impresoras: [
      'PIXMA MG3110',
      'PIXMA MG3210',
      'PIXMA MG3510',
      'PIXMA MG3610',
      'PIXMA MX371',
      'PIXMA MX391',
      'PIXMA MX431',
      'PIXMA MX471',
    ],
    fuentes: [
      'https://www.canon.com.br/produtos/produtos-para-voce---impressoras---linha-de-cartuchos/cartucho-de-tinta-pg-140-bk-xl',
      'https://www.canon.com.br/produtos/produtos-para-voce/impressoras/linha-de-cartuchos/cartucho-de-tinta-pg-140-bk',
    ],
    consultado: '2026-10-07',
  },
  // Samsung Corea («호환 기기», dispositivos compatibles) y la tienda de HP, que hoy vende los consumibles de Samsung.
  {
    marca: 'Samsung',
    cartuchos: ['MLT-D111S'],
    impresoras: [
      'Xpress M2020',
      'Xpress M2020W',
      'Xpress M2022',
      'Xpress M2022W',
      'Xpress M2024',
      'Xpress M2024W',
      'Xpress M2026',
      'Xpress M2026W',
      'Xpress M2028',
      'Xpress M2028W',
      'Xpress M2070',
      'Xpress M2070W',
      'Xpress M2070F',
      'Xpress M2070FW',
      'Xpress M2074',
      'Xpress M2074W',
      'Xpress M2074F',
      'Xpress M2074FW',
      'Xpress M2078',
      'Xpress M2078W',
      'Xpress M2078F',
      'Xpress M2078FW',
      'Xpress M2060FH',
    ],
    fuentes: [
      'https://www.samsung.com/sec/support/model/MLT-D111S/',
      'https://www.hp.com/fr-fr/shop/products/supplies/mlt-d111s-cartouche-d-encre-noire-hp-authentique-su810a',
    ],
    consultado: '2026-10-07',
  },
  {
    marca: 'Samsung',
    cartuchos: ['MLT-D101S'],
    impresoras: [
      'ML-2164',
      'ML-2164W',
      'SCX-3400',
      'SCX-3405',
      'SCX-3401FH',
      'SCX-3406',
      'SCX-3406F',
      'SCX-3406FH',
      'SCX-3406HW',
      'SF-760P',
      'SF-765P',
    ],
    fuentes: [
      'https://www.samsung.com/sec/support/model/MLT-D101S/',
      'https://www.hp.com/fr-fr/shop/products/supplies/mlt-d101s-cartouche-d-encre-noire-hp-authentique-su696a',
    ],
    consultado: '2026-10-07',
  },

  // ── El quinto tramo: lo que faltaba del top 200 ────────────────────────────
  //
  // Medido el 2026-10-14 sobre los 200 productos más vendidos: cartuchos sin
  // impresoras y láser de HP que no tenían ni el cartucho enlazado. Igual que en
  // el cuarto tramo, de las páginas LatAm de HP entra la SERIE sin «(serie)», y
  // los modelos concretos salen de la tienda de HP US o Canadá, sin el
  // «Printer» que añade la tienda. Fuera:
  //   · HP 105X: sigue sin existir en hp.com (solo el 105A).
  //   · GI-10 en las GM2010 y GM4010: son monocromáticas y aquí el GI-10 es UN
  //     cartucho con las cuatro botellas; enlazarlo les ofrecería el color.
  //   · Lo que solo nombra una página de otro país (M127fs, España) o un
  //     distribuidor (MG2110, MX371… del CL-141): sin página oficial que abrir.
  {
    marca: 'HP',
    cartuchos: ['85A', 'CE285A'],
    impresoras: [
      'LaserJet Pro P1100',
      'LaserJet Pro MFP M1130',
      'LaserJet Pro MFP M1210',
      'LaserJet Pro P1102w',
      'LaserJet Pro P1109w',
      'LaserJet Pro M1212nf',
      'LaserJet Pro M1217nfw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-85a-negro-laserjet-original-ce285a.html',
      'https://www.hp.com/co-es/shop/cartucho-de-toner-hp-85a-negro-laserjet-original-ce285a.html',
      'https://www.hp.com/us-en/shop/pdp/hp-85a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-85a-black-original-laserjet-toner-cartridge-ce285a',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['83A', 'CF283A'],
    impresoras: [
      'LaserJet Pro MFP M125',
      'LaserJet Pro MFP M127',
      'LaserJet Pro M201n',
      'LaserJet Pro M201dw',
      'LaserJet Pro MFP M225dn',
      'LaserJet Pro MFP M225dw',
      'LaserJet Pro MFP M127fn',
      'LaserJet Pro MFP M127fw',
      'LaserJet Pro MFP M127fp',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-83a-negro-laserjet-original-cf283a.html',
      'https://www.hp.com/us-en/shop/pdp/hp-83a-black-original-laserjet-toner-cartridge-cf283a',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-83a-black-original-laserjet-toner-cartridge-cf283a',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['87A', 'CF287A'],
    impresoras: [
      'LaserJet Enterprise M506',
      'LaserJet Enterprise MFP M527',
      'LaserJet Enterprise M506n',
      'LaserJet Enterprise M506dn',
      'LaserJet Enterprise M506x',
      'LaserJet Enterprise MFP M527dn',
      'LaserJet Enterprise MFP M527f',
      'LaserJet Enterprise Flow MFP M527z',
      'LaserJet Pro M501dn',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-87a-negro-laserjet-original-cf287a.html',
      'https://www.hp.com/co-es/shop/cartucho-de-toner-hp-87a-negro-laserjet-original-cf287a.html',
      'https://www.hp.com/us-en/shop/pdp/hp-87a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-87a-black-original-laserjet-toner-cartridge-cf287a',
    ],
    consultado: '2026-10-14',
  },
  // Las mismas impresoras que el 89A del cuarto tramo.
  {
    marca: 'HP',
    cartuchos: ['89X', 'CF289X'],
    impresoras: [
      'LaserJet Enterprise M507',
      'LaserJet Enterprise MFP M528',
      'LaserJet Enterprise M507n',
      'LaserJet Enterprise M507dn',
      'LaserJet Enterprise M507dng',
      'LaserJet Enterprise M507x',
      'LaserJet Enterprise MFP M528dn',
      'LaserJet Enterprise MFP M528f',
      'LaserJet Enterprise Flow MFP M528c',
      'LaserJet Enterprise Flow MFP M528z',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-89x-negro-laserjet-original-cf289x.html',
      'https://www.hp.com/pe-es/shop/cartucho-de-toner-hp-89x-negro-alto-rendimiento-laserjet-original-cf289x.html',
      'https://www.hp.com/us-en/shop/pdp/hp-89x-high-yield-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-89x-high-yield-black-original-laserjet-toner-cartridge-cf289x',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['17A', 'CF217A'],
    impresoras: [
      'LaserJet Pro M102',
      'LaserJet Pro MFP M130',
      'LaserJet Pro M102w',
      'LaserJet Pro MFP M130fn',
      'LaserJet Pro MFP M130fw',
      'LaserJet Pro MFP M130nw',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-17a-negro-laserjet-original-cf217a.html',
      'https://www.hp.com/co-es/shop/cartucho-de-toner-hp-17a-negro-laserjet-original-cf217a.html',
      'https://www.hp.com/us-en/shop/pdp/hp-17a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-17a-black-original-laserjet-toner-cartridge-cf217a',
    ],
    consultado: '2026-10-14',
  },
  // La ficha LatAm solo nombra las M630; las M605, M606 y «Managed» las añaden
  // las tiendas de EE. UU. y Canadá.
  {
    marca: 'HP',
    cartuchos: ['81X', 'CF281X'],
    impresoras: [
      'LaserJet Enterprise MFP M630dn',
      'LaserJet Enterprise MFP M630f',
      'LaserJet Enterprise MFP M630h',
      'LaserJet Enterprise Flow MFP M630z',
      'LaserJet Enterprise Flow MFP M630h',
      'LaserJet Enterprise M605n',
      'LaserJet Enterprise M605dn',
      'LaserJet Enterprise M605dh',
      'LaserJet Enterprise M605x',
      'LaserJet Enterprise M606dn',
      'LaserJet Enterprise M606x',
      'LaserJet Managed M605xm',
      'LaserJet Managed Flow MFP M630zm',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-81x-negro-alto-rendimiento-laserjet-original-cf281x.html',
      'https://www.hp.com/co-es/shop/cartucho-de-toner-hp-81x-negro-alto-rendimiento-laserjet-original-cf281x.html',
      'https://www.hp.com/us-en/shop/pdp/hp-81x-high-yield-black-original-laserjet-toner-cartridge-cf281x',
      'https://www.hp.com/ca-en/shop/products/supplies/hp-81x-high-yield-black-original-laserjet-toner-cartridge-cf281x',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    // "CF280" es como lo escribe el ASTA «CF280-CE505A»: el 80A y el 80X van en
    // las mismas impresoras, así que el código sin la letra también vale aquí.
    cartuchos: ['80A', 'CF280A', 'CF280'],
    impresoras: [
      'LaserJet Pro 400 M401',
      'LaserJet Pro 400 MFP M425',
      'LaserJet Pro 400 M401n',
      'LaserJet Pro 400 M401dn',
      'LaserJet Pro 400 M401dne',
      'LaserJet Pro 400 M401dw',
      'LaserJet Pro 400 MFP M425dn',
    ],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-80a-negro-laserjet-original-cf280a.html',
      'https://www.hp.com/co-es/shop/cartucho-de-toner-hp-80a-negro-laserjet-original-cf280a.html',
      'https://www.hp.com/us-en/shop/pdp/hp-80a-black-original-laserjet-toner-cartridge',
    ],
    consultado: '2026-10-14',
  },
  // Los cuatro colores nombran las mismas impresoras. La M552dn y la M577c no
  // las nombra ninguna página de HP modelo a modelo (solo «M552/M553»).
  {
    marca: 'HP',
    cartuchos: ['508A', 'CF360A', 'CF361A', 'CF362A', 'CF363A'],
    impresoras: [
      'Color LaserJet Enterprise M553n',
      'Color LaserJet Enterprise M553x',
      'Color LaserJet Enterprise M553dn',
      'Color LaserJet Enterprise M553dh',
      'Color LaserJet Enterprise MFP M577f',
      'Color LaserJet Enterprise MFP M577dn',
      'Color LaserJet Enterprise Flow MFP M577z',
    ],
    fuentes: [
      'https://www.hp.com/us-en/shop/pdp/hp-508a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/us-en/shop/pdp/hp-508a-cyan-original-laserjet-toner-cartridge',
      'https://www.hp.com/uy-es/products/ink-toner/product-details/6888220',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-508a-cian-laserjet-original-cf361a.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['55A', 'CE255A'],
    impresoras: [
      'LaserJet Enterprise P3015d',
      'LaserJet Enterprise P3015n',
      'LaserJet Enterprise P3015dn',
      'LaserJet Enterprise P3015x',
      'LaserJet Enterprise Flow MFP M525c',
      'LaserJet Enterprise 500 MFP M525dn',
      'LaserJet Enterprise 500 MFP M525f',
      'LaserJet Pro MFP M521dn',
    ],
    fuentes: [
      'https://www.hp.com/us-en/shop/pdp/hp-55a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/ve-es/products/ink-toner/product-details/3724333',
    ],
    consultado: '2026-10-14',
  },
  // Los nombres, como los escribe HP, aunque llame «Flow» a la M631h y no a la M631z.
  {
    marca: 'HP',
    cartuchos: ['37X', 'CF237X'],
    impresoras: [
      'LaserJet Enterprise M608n',
      'LaserJet Enterprise M608dn',
      'LaserJet Enterprise M608x',
      'LaserJet Enterprise M609dn',
      'LaserJet Enterprise M609x',
      'LaserJet Enterprise Flow MFP M631h',
      'LaserJet Enterprise MFP M631z',
      'LaserJet Enterprise MFP M632h',
      'LaserJet Enterprise MFP M632fht',
      'LaserJet Enterprise Flow MFP M632z',
      'LaserJet Enterprise MFP M633fh',
    ],
    fuentes: ['https://www.hp.com/us-en/shop/pdp/hp-37x-high-yield-black-original-laserjet-toner-cartridge'],
    consultado: '2026-10-14',
  },
  // Los cuatro colores nombran las mismas impresoras.
  {
    marca: 'HP',
    cartuchos: ['410A', 'CF410A', 'CF411A', 'CF412A', 'CF413A'],
    impresoras: [
      'Color LaserJet Pro M452dn',
      'Color LaserJet Pro M452nw',
      'Color LaserJet Pro M452dw',
      'Color LaserJet Pro MFP M477fdn',
      'Color LaserJet Pro MFP M477fdw',
      'Color LaserJet Pro MFP M477fnw',
    ],
    fuentes: [
      'https://www.hp.com/us-en/shop/pdp/hp-410a-black-original-laserjet-toner-cartridge',
      'https://www.hp.com/us-en/shop/pdp/hp-410a-cyan-original-laserjet-toner-cartridge',
      'https://www.hp.com/ve-es/products/ink-toner/product-details/8610926',
    ],
    consultado: '2026-10-14',
  },
  // HP Venezuela repite la 9010e sin «Pro»: es la misma, va una vez.
  {
    marca: 'HP',
    cartuchos: ['964', '964XL'],
    impresoras: [
      'OfficeJet Pro 9010',
      'OfficeJet Pro 9010e',
      'OfficeJet Pro 9015e',
      'OfficeJet Pro 9016',
      'OfficeJet Pro 9018',
      'OfficeJet Pro 9020',
      'OfficeJet Pro 9025e',
    ],
    fuentes: [
      'https://www.hp.com/ve-es/products/ink-toner/product-details/21858533',
      'https://www.hp.com/mx-es/shop/cartucho-de-tinta-de-hp-964xl-negro-alto-rendimiento-3ja57al.html',
    ],
    consultado: '2026-10-14',
  },
  // El CL-141 no tiene página con su lista: sale al revés, de la ficha de cada
  // impresora que dice usarlo. La GM4010 es monocromática y lo acepta como
  // cartucho de color opcional.
  {
    marca: 'Canon',
    cartuchos: ['CL-141', 'CL-141XL'],
    impresoras: [
      'PIXMA MG2210',
      'PIXMA MG3210',
      'PIXMA MG3510',
      'PIXMA MG3610',
      'PIXMA MG4210',
      'PIXMA MX391',
      'PIXMA MX451',
      'PIXMA MX471',
      'PIXMA MX521',
      'PIXMA MX531',
      'PIXMA GM4010',
    ],
    fuentes: [
      'https://www.cla.canon.com/en/p/pixma-mg2210',
      'https://www.cla.canon.com/en/p/pixma-mg3210',
      'https://www.cla.canon.com/en/p/pixma-mg3510',
      'https://www.cla.canon.com/en/p/pixma-mg3610',
      'https://www.cla.canon.com/en/p/pixma-mg4210',
      'https://www.cla.canon.com/en/p/pixma-mx391',
      'https://www.cla.canon.com/en/p/pixma-mx451',
      'https://www.cla.canon.com/en/p/pixma-mx471',
      'https://www.cla.canon.com/en/p/pixma-mx521',
      'https://www.cla.canon.com/en/p/pixma-mx531',
      'https://www.cla.canon.com/en/p/pixma-gm4010',
      'https://www.canon.cl/productos/tinta/pixma-gm4010',
    ],
    consultado: '2026-10-14',
  },
  // El PG-210 y el CL-211 nombran las mismas impresoras; la MP230 la añade
  // Canon Latinoamérica.
  {
    marca: 'Canon',
    cartuchos: ['PG-210', 'PG-210XL'],
    impresoras: [
      'PIXMA MX330',
      'PIXMA MP240',
      'PIXMA MP480',
      'PIXMA MP490',
      'PIXMA iP2702',
      'PIXMA MX340',
      'PIXMA MX350',
      'PIXMA MX320',
      'PIXMA MP250',
      'PIXMA MP270',
      'PIXMA MP280',
      'PIXMA MP495',
      'PIXMA MX410',
      'PIXMA MX420',
      'PIXMA MP230',
    ],
    fuentes: [
      'https://www.usa.canon.com/shop/p/pg-210-xl-black-ink-tank',
      'https://shop.canon.ca/en_ca/p/pg-210-black-ink-cartridge',
      'https://shop.canon.ca/en_ca/p/pg-210-xl-ink-tank',
      'https://www.cla.canon.com/en/p/pixma-mp230',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'Canon',
    cartuchos: ['CL-211', 'CL-211XL'],
    impresoras: [
      'PIXMA MX330',
      'PIXMA MP240',
      'PIXMA MP480',
      'PIXMA MP490',
      'PIXMA iP2702',
      'PIXMA MX340',
      'PIXMA MX350',
      'PIXMA MX320',
      'PIXMA MP250',
      'PIXMA MP270',
      'PIXMA MP280',
      'PIXMA MP495',
      'PIXMA MX410',
      'PIXMA MX420',
      'PIXMA MP230',
    ],
    fuentes: [
      'https://www.usa.canon.com/shop/p/cl-211-xl-ink-tank',
      'https://shop.canon.ca/en_ca/p/cl-211-xl-colour-ink-tank',
      'https://www.cla.canon.com/en/p/pixma-mp230',
    ],
    consultado: '2026-10-14',
  },
  // Canon Chile nombra tres; EE. UU. y Canadá añaden la LBP215dw y la MF429dw.
  {
    marca: 'Canon',
    cartuchos: ['052', '052H'],
    impresoras: [
      'imageCLASS LBP214dw',
      'imageCLASS LBP215dw',
      'imageCLASS MF424dw',
      'imageCLASS MF426dw',
      'imageCLASS MF429dw',
    ],
    fuentes: [
      'https://www.usa.canon.com/shop/p/052-black-toner-cartridge',
      'https://www.usa.canon.com/shop/p/052-black-toner-cartridge-high-capacity',
      'https://shop.canon.ca/en_ca/p/052-black-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/052-black-toner-cartridge-high-capacity',
      'https://www.canon.cl/productos/toner/cartridge-052',
      'https://www.canon.cl/productos/toner/cartridge-052-h',
    ],
    consultado: '2026-10-14',
  },
  // Negro y colores, normal y alta capacidad: la misma lista. La tienda escribe
  // «MF641Cdw»; el modelo es la MF641Cw, como la llama su página de soporte.
  {
    marca: 'Canon',
    cartuchos: ['054', '054H'],
    impresoras: [
      'Color imageCLASS LBP622Cdw',
      'Color imageCLASS LBP623Cdw',
      'Color imageCLASS MF641Cw',
      'Color imageCLASS MF642Cdw',
      'Color imageCLASS MF644Cdw',
    ],
    fuentes: [
      'https://www.usa.canon.com/shop/p/054-black-toner-cartridge-high-capacity',
      'https://www.usa.canon.com/shop/p/054-cyan-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/054-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/054-h-toner-cartridge-high-capacity',
      'https://www.usa.canon.com/support/p/color-imageclass-mf641cw',
    ],
    consultado: '2026-10-14',
  },
  // La ficha habla de series (MF210, MF220, MF230, MF240): entran los modelos
  // que confirman su propia página de soporte, y la MF242dw por ser de la MF240.
  {
    marca: 'Canon',
    cartuchos: ['137'],
    impresoras: [
      'imageCLASS LBP151dw',
      'imageCLASS MF212w',
      'imageCLASS MF216n',
      'imageCLASS MF217w',
      'imageCLASS MF227dw',
      'imageCLASS MF229dw',
      'imageCLASS MF232w',
      'imageCLASS MF236n',
      'imageCLASS MF242dw',
      'imageCLASS MF244dw',
      'imageCLASS MF247dw',
      'imageCLASS MF249dw',
      'imageCLASS D570',
    ],
    fuentes: [
      'https://www.usa.canon.com/shop/p/137-black-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/137-black-toner-cartridge',
      'https://www.usa.canon.com/support/p/imageclass-mf212w',
      'https://www.usa.canon.com/support/p/imageclass-mf244dw',
      'https://www.usa.canon.com/support/p/imageclass-mf249dw',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'Canon',
    cartuchos: ['128'],
    impresoras: [
      'imageCLASS MF4450',
      'imageCLASS MF4770n',
      'imageCLASS MF4570dw',
      'imageCLASS MF4570dn',
      'imageCLASS MF4880dw',
      'imageCLASS MF4890dw',
      'imageCLASS D530',
      'imageCLASS D550',
      'FAXPHONE L100',
      'FAXPHONE L190',
    ],
    fuentes: [
      'https://www.usa.canon.com/shop/p/128-black-toner-cartridge',
      'https://shop.canon.ca/en_ca/p/128-black-toner-cartridge',
    ],
    consultado: '2026-10-14',
  },
  // Solo las tres a color: ver la cabecera del tramo.
  {
    marca: 'Canon',
    cartuchos: ['GI-10'],
    impresoras: ['PIXMA G5010', 'PIXMA G6010', 'PIXMA G7010'],
    fuentes: [
      'https://www.canon.cl/productos/tinta/gi-10-cyan',
      'https://www.canon.cl/productos/tinta/gi-10-pigment-black',
      'https://www.cla.canon.com/en/p/pixma-g5010',
    ],
    consultado: '2026-10-14',
  },
  // HP vende hoy los suministros de Samsung; su ficha abrevia «ML-1660/1665/…».
  {
    marca: 'Samsung',
    cartuchos: ['MLT-D104S'],
    impresoras: [
      'ML-1660',
      'ML-1665',
      'ML-1670',
      'ML-1675',
      'ML-1860',
      'ML-1865',
      'ML-1865W',
      'SCX-3200',
      'SCX-3205',
      'SCX-3205W',
    ],
    fuentes: [
      'https://www.hp.com/cl-es/shop/cartucho-de-toner-samsung-mlt-d104s-negro-original-su750a.html',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-mlt-d104s-negro-samsung-su751a.html',
    ],
    consultado: '2026-10-14',
  },

  // ── El sexto tramo: los ASTA que no llegaban a ninguna impresora ───────────
  //
  // Medido el 2026-10-14: tóneres ASTA con su cartucho ya validado, pero ese
  // cartucho sin ninguna impresora. El kiosco no los podía recomendar.
  // La tienda de HP de EE. UU. no cargó: los modelos concretos salen de las
  // GUÍAS DE USUARIO oficiales (h10032.www1.hp.com/ctg/Manual), que nombran el
  // modelo y el número de pieza en su tabla de consumibles, y las fichas de las
  // tiendas de HP de otros países confirman la serie. Fuera:
  //   · lo que solo se vio en un buscador sin abrir la página (4240n, P2014n);
  //   · el 4240 en el 42X: la guía de HP para Latinoamérica dice que solo usa el
  //     42A, y la ficha del 42X lo deja fuera;
  //   · las P2035 en el 05X: su guía solo da el 05A.
  {
    marca: 'HP',
    cartuchos: ['05A', 'CE505A'],
    impresoras: ['LaserJet P2035', 'LaserJet P2035n', 'LaserJet P2055', 'LaserJet P2055d', 'LaserJet P2055dn', 'LaserJet P2055x'],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c01461682.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c01460703.pdf',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-05a-negro-laserjet-original-ce505a.html',
      'https://www.hp.com/my-en/shop/hp-05a-black-original-laserjet-toner-cartridge-ce505a.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['05X', 'CE505X'],
    impresoras: ['LaserJet P2055', 'LaserJet P2055d', 'LaserJet P2055dn', 'LaserJet P2055x'],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c01461682.pdf',
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-hp-05x-negro-alto-rendimiento-laserjet-original-ce505x.html',
      'https://www.hp.com/my-en/shop/hp-05x-high-yield-black-original-laserjet-toner-cartridge-ce505x.html',
    ],
    consultado: '2026-10-14',
  },
  // «LaserJet 4350» es la serie: los modelos son las n, tn, dtn y dtnsl.
  {
    marca: 'HP',
    cartuchos: ['42X', 'Q5942X'],
    impresoras: [
      'LaserJet 4250',
      'LaserJet 4250n',
      'LaserJet 4250tn',
      'LaserJet 4250dtn',
      'LaserJet 4250dtnsl',
      'LaserJet 4350',
      'LaserJet 4350n',
      'LaserJet 4350tn',
      'LaserJet 4350dtn',
      'LaserJet 4350dtnsl',
    ],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c00218691.pdf',
      'https://www.hp.com/br-pt/shop/cartucho-original-de-toner-negro-de-alto-rendimiento-hp-42x-laserjet-q5942x.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['42A', 'Q5942A'],
    impresoras: [
      'LaserJet 4240',
      'LaserJet 4250',
      'LaserJet 4250n',
      'LaserJet 4250tn',
      'LaserJet 4250dtn',
      'LaserJet 4250dtnsl',
      'LaserJet 4350',
      'LaserJet 4350n',
      'LaserJet 4350tn',
      'LaserJet 4350dtn',
      'LaserJet 4350dtnsl',
    ],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c00218691.pdf',
      'https://www.hp.com/my-en/shop/hp-42a-black-original-laserjet-toner-cartridge-q5942a.html',
      'https://www.hp.com/latam/mx/hogar/productos/supplies/tintas/Guia_Compatibilidad_1005_HP_SRG_T2_esp.pdf',
    ],
    consultado: '2026-10-15',
  },
  {
    marca: 'HP',
    cartuchos: ['53A', 'Q7553A', '53X', 'Q7553X'],
    impresoras: [
      'LaserJet P2015',
      'LaserJet P2015d',
      'LaserJet P2015n',
      'LaserJet P2015dn',
      'LaserJet P2015x',
      'LaserJet P2014',
      'LaserJet M2727 MFP',
      'LaserJet M2727nf MFP',
      'LaserJet M2727nfs MFP',
    ],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c00623611.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c01072069.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c00810215.pdf',
      'https://www.hp.com/hk-en/shop/hp-53a-black-original-laserjet-toner-cartridge-q7553a.html',
    ],
    consultado: '2026-10-15',
  },
  {
    marca: 'HP',
    cartuchos: ['49A', 'Q5949A'],
    impresoras: ['LaserJet 1160', 'LaserJet 1320', 'LaserJet 1320n', 'LaserJet 1320tn', 'LaserJet 1320nw', 'LaserJet 3390 All-in-One', 'LaserJet 3392 All-in-One'],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c00208219.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c00495173.pdf',
      'https://www.hp.com/hk-en/shop/hp-49a-black-original-laserjet-toner-cartridge-q5949a.html',
    ],
    consultado: '2026-10-15',
  },
  {
    marca: 'HP',
    cartuchos: ['51A', 'Q7551A'],
    impresoras: [
      'LaserJet P3005',
      'LaserJet P3005d',
      'LaserJet P3005n',
      'LaserJet P3005dn',
      'LaserJet P3005x',
      'LaserJet M3027 MFP',
      'LaserJet M3027x MFP',
      'LaserJet M3035 MFP',
      'LaserJet M3035xs MFP',
    ],
    fuentes: ['https://h10032.www1.hp.com/ctg/Manual/c01057465.pdf', 'https://h10032.www1.hp.com/ctg/Manual/c00744962.pdf'],
    consultado: '2026-10-14',
  },
  // El kit de recarga de las Neverstop. Las guías dicen «103A/143A»: el 143A es el
  // mismo kit en otras regiones.
  {
    marca: 'HP',
    cartuchos: ['103A', 'W1103A'],
    impresoras: [
      'Neverstop Laser 1000',
      'Neverstop Laser 1000a',
      'Neverstop Laser 1000n',
      'Neverstop Laser 1000w',
      'Neverstop Laser 1001nw',
      'Neverstop Laser MFP 1200',
      'Neverstop Laser MFP 1200a',
      'Neverstop Laser MFP 1200n',
      'Neverstop Laser MFP 1200w',
      'Neverstop Laser MFP 1200nw',
      'Neverstop Laser MFP 1201n',
      'Neverstop Laser MFP 1202nw',
      'Neverstop Laser MFP 1202w',
    ],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c06318365.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c06318495.pdf',
      'https://www.hp.com/mx-es/shop/kit-de-recarga-de-toner-hp-laser-103a-negro-w1103a.html',
      'https://www.hp.com/my-en/shop/hp-103a-black-original-neverstop-laser-toner-reload-kit-w1103a.html',
    ],
    consultado: '2026-10-15',
  },
  // El tambor de las M102/M104 y las MFP M130/M132.
  {
    marca: 'HP',
    cartuchos: ['19A', 'CF219A'],
    impresoras: [
      'LaserJet Pro M102',
      'LaserJet Pro M102w',
      'LaserJet Pro M104',
      'LaserJet Pro M104w',
      'LaserJet Pro MFP M130',
      'LaserJet Pro MFP M130a',
      'LaserJet Pro MFP M130nw',
      'LaserJet Pro MFP M130fn',
      'LaserJet Pro MFP M130fw',
      'LaserJet Pro MFP M132',
      'LaserJet Pro MFP M132a',
      'LaserJet Pro MFP M132nw',
      'LaserJet Pro MFP M132snw',
      'LaserJet Pro MFP M132fn',
      'LaserJet Pro MFP M132fp',
      'LaserJet Pro MFP M132fw',
    ],
    fuentes: [
      'https://h10032.www1.hp.com/ctg/Manual/c05208327.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c05172884.pdf',
      'https://www.hp.com/au-en/shop/hp-19a-original-laserjet-imaging-drum-cf219a.html',
    ],
    consultado: '2026-10-15',
  },
  {
    marca: 'HP',
    cartuchos: ['79A', 'CF279A'],
    impresoras: ['LaserJet Pro M12a', 'LaserJet Pro M12w', 'LaserJet Pro MFP M26a', 'LaserJet Pro MFP M26nw'],
    fuentes: [
      'https://www.hp.com/hk-en/shop/hp-79a-black-original-laserjet-toner-cartridge-cf279a.html',
      'https://h10032.www1.hp.com/ctg/Manual/c05188828.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c05185468.pdf',
    ],
    consultado: '2026-10-15',
  },
  // Los cuatro colores nombran las mismas impresoras. La ficha de Hong Kong llama
  // «Flow» a la M578dn y la M578f; su guía no, y así quedan.
  {
    marca: 'HP',
    cartuchos: ['212A', 'W2120A', 'W2121A', 'W2122A', 'W2123A'],
    impresoras: [
      'Color LaserJet Enterprise M554dn',
      'Color LaserJet Enterprise M555dn',
      'Color LaserJet Enterprise M555x',
      'Color LaserJet Enterprise MFP M578dn',
      'Color LaserJet Enterprise MFP M578f',
      'Color LaserJet Enterprise Flow MFP M578c',
      'Color LaserJet Enterprise Flow MFP M578z',
    ],
    fuentes: [
      'https://www.hp.com/hk-en/shop/hp-212a-black-original-laserjet-toner-cartridge-w2120a.html',
      'https://h10032.www1.hp.com/ctg/Manual/c06637211.pdf',
      'https://h10032.www1.hp.com/ctg/Manual/c06634385.pdf',
    ],
    consultado: '2026-10-15',
  },
  // Los láser color de HP: solo la tienda de HP Tailandia nombra los modelos uno
  // a uno; las de Australia, Hong Kong o Arabia Saudí confirman la serie. En
  // cada uno, los cuatro colores nombran las mismas impresoras.
  {
    marca: 'HP',
    cartuchos: ['128A', 'CE320A', 'CE321A', 'CE322A', 'CE323A'],
    impresoras: ['LaserJet Pro CP1525', 'LaserJet Pro CP1525n', 'LaserJet Pro CP1525nw', 'LaserJet Pro CM1415', 'LaserJet Pro CM1415fn', 'LaserJet Pro CM1415fnw'],
    fuentes: [
      'https://www.hp.com/th-en/shop/hp-128a-black-original-laserjet-toner-cartridge-ce320a.html',
      'https://www.hp.com/au-en/shop/hp-128a-black-original-laserjet-toner-cartridge-ce320a.html',
      'https://www.hp.com/sa-en/shop/hp-128a-black-original-laserjet-toner-cartridge-ce320a.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['125A', 'CB540A', 'CB541A', 'CB542A', 'CB543A'],
    impresoras: ['Color LaserJet CP1215', 'Color LaserJet CP1515n', 'Color LaserJet CP1518ni', 'Color LaserJet CM1312', 'Color LaserJet CM1312nfi'],
    fuentes: [
      'https://www.hp.com/th-en/shop/hp-125a-black-original-laserjet-toner-cartridge-cb540a.html',
      'https://www.hp.com/sa-en/shop/hp-125a-black-original-laserjet-toner-cartridge-cb540a.html',
      'https://www.hp.com/au-en/shop/hp-125a-black-original-laserjet-toner-cartridge-cb540a.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['131A', 'CF210A', '131X', 'CF210X', 'CF211A', 'CF212A', 'CF213A'],
    impresoras: [
      'LaserJet Pro 200 color M251',
      'LaserJet Pro 200 color M251n',
      'LaserJet Pro 200 color M251nw',
      'LaserJet Pro 200 color MFP M276',
      'LaserJet Pro 200 color MFP M276n',
      'LaserJet Pro 200 color MFP M276nw',
    ],
    fuentes: [
      'https://www.hp.com/th-en/shop/hp-131a-black-original-laserjet-toner-cartridge-cf210a.html',
      'https://www.hp.com/hk-en/shop/hp-131x-high-yield-black-original-laserjet-toner-cartridge-cf210x.html',
      'https://www.hp.com/au-en/shop/hp-131a-black-original-laserjet-toner-cartridge-cf210a.html',
    ],
    consultado: '2026-10-14',
  },
  // Las M175 y la TopShot M275 solo las nombra la tienda de Tailandia; las demás,
  // la serie CP1020.
  {
    marca: 'HP',
    cartuchos: ['126A', 'CE310A', 'CE311A', 'CE312A', 'CE313A'],
    impresoras: [
      'LaserJet Pro CP1020',
      'Color LaserJet CP1025',
      'Color LaserJet CP1025nw',
      'LaserJet Pro 100 color MFP M175a',
      'LaserJet Pro 100 color MFP M175nw',
      'TopShot LaserJet Pro M275',
    ],
    fuentes: [
      'https://www.hp.com/th-en/shop/hp-126a-black-original-laserjet-toner-cartridge-ce310a.html',
      'https://www.hp.com/au-en/shop/hp-126a-black-original-laserjet-toner-cartridge-ce310a.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['130A', 'CF350A', 'CF351A', 'CF352A', 'CF353A'],
    impresoras: ['Color LaserJet Pro MFP M176', 'Color LaserJet Pro MFP M176n', 'Color LaserJet Pro MFP M177', 'Color LaserJet Pro MFP M177fw'],
    fuentes: [
      'https://www.hp.com/th-en/shop/hp-130a-black-original-laserjet-toner-cartridge-cf350a.html',
      'https://www.hp.com/au-en/shop/hp-130a-black-original-laserjet-toner-cartridge-cf350a.html',
    ],
    consultado: '2026-10-14',
  },
  {
    marca: 'HP',
    cartuchos: ['204A', 'CF510A', 'CF511A', 'CF512A', 'CF513A'],
    impresoras: [
      'Color LaserJet Pro M154',
      'Color LaserJet Pro M154a',
      'Color LaserJet Pro M154nw',
      'Color LaserJet Pro MFP M180',
      'Color LaserJet Pro MFP M180n',
      'Color LaserJet Pro MFP M180nw',
      'Color LaserJet Pro MFP M181fw',
    ],
    fuentes: [
      'https://www.hp.com/th-en/shop/hp-204a-black-original-laserjet-toner-cartridge-cf510a.html',
      'https://www.hp.com/hk-en/shop/ink-toner.html?supply-related=hp-color-laserjet-pro-mfp-m180nw-t6b74a-',
      'https://www.hp.com/au-en/shop/hp-204a-black-original-laserjet-toner-cartridge-cf510a.html',
    ],
    consultado: '2026-10-14',
  },
  // HP México, que vende hoy los Samsung. Fuera «ML-2541» y «ML-2645», que nombra
  // esa ficha pero no son modelos de Samsung: erratas, y crearían impresoras falsas.
  {
    marca: 'Samsung',
    cartuchos: ['MLT-D105S'],
    impresoras: ['ML-1910', 'ML-1915', 'ML-2525', 'ML-2525W', 'ML-2580N', 'ML-2540', 'ML-2545', 'SF-650', 'SF-650P', 'SCX-4600', 'SCX-4623F', 'SCX-4623FN', 'SCX-4623FW'],
    fuentes: [
      'https://www.hp.com/mx-es/shop/cartucho-de-toner-mlt-d105s-negro-samsung-su779a.html',
      'https://www.samsung.com/us/system/consumer/product/sc/x4/62/scx4623fwxaa/SCX_4623FW.pdf',
    ],
    consultado: '2026-10-15',
  },
  // Las botellas Epson: la unión de lo que dicen las webs de Epson de cada país.
  // Fuera del 664 las L606, L655, L656 y L1455: usan el 664 solo en COLOR (su
  // negro es otro), y aquí el T664 es UN cartucho con las cuatro botellas:
  // enlazarlo les ofrecería un negro que no les sirve. Y la L850, que alguna web
  // pone en el negro del 664 pero es del 673 en todos los colores.
  {
    marca: 'Epson',
    cartuchos: ['T664', 'T664120', 'T664220', 'T664320', 'T664420'],
    impresoras: [
      'EcoTank L110',
      'EcoTank L120',
      'EcoTank L121',
      'L200',
      'EcoTank L210',
      'EcoTank L220',
      'EcoTank L310',
      'L350',
      'EcoTank L355',
      'EcoTank L365',
      'EcoTank L375',
      'EcoTank L380',
      'EcoTank L395',
      'EcoTank L396',
      'EcoTank L455',
      'EcoTank L475',
      'EcoTank L495',
      'EcoTank L555',
      'EcoTank L565',
      'EcoTank L575',
      'EcoTank L1300',
      'Expression ET-2550',
    ],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T664/i/T664120-AL',
      'https://epson.com.pe/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T664/i/T664120-AL',
      'https://epson.com.co/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T664/i/T664120-AL',
      'https://epson.com.ve/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T664/i/T664',
      'https://epson.cl/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T664/i/T664120-AL',
      'https://epson.com.ar/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T664/i/T664120-AL',
    ],
    consultado: '2026-10-15',
  },
  {
    marca: 'Epson',
    cartuchos: ['T673', 'T673120', 'T673220', 'T673320', 'T673420', 'T673520', 'T673620'],
    impresoras: ['EcoTank L800', 'EcoTank L805', 'EcoTank L810', 'EcoTank L850', 'EcoTank L1800'],
    fuentes: [
      'https://epson.com.mx/Para-el-hogar/Tintas/Botella-de-Tinta-Epson-T673/i/T673',
      'https://epson.com.co/Para-el-hogar/Tintas/Botella-de-Tinta-Epson-T673/i/T673120-AL',
      'https://epson.cl/Para-el-hogar/Tintas/Botella-de-Tinta-Epson-673/i/T673',
      'https://epson.com.ve/Para-el-hogar/Tintas/Botella-de-Tinta-Epson-T673/i/T673',
    ],
    consultado: '2026-10-15',
  },
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
