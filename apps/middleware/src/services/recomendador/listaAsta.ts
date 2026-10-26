import type { ListaFabricante } from './importarListasFabricante.js';

/**
 * La lista de compatibilidades de la marca ASTA para Venezuela, en PDF, del
 * distribuidor. Va aparte de `LISTAS_FABRICANTE` porque no sale de la web de HP,
 * Canon o Samsung: es lo que ASTA declara de sus propios tóners. Entra igual,
 * como PROPUESTA de lista, y en `source_ref` va el documento en vez de una URL.
 *
 * Cada fila del PDF es un tóner ASTA, nombrado por el código del original al
 * que sustituye, con sus impresoras. Aquí va el ORIGINAL con esas impresoras:
 * el kiosco llega al ASTA por el enlace producto → cartucho, que ya existe.
 *
 * Los tóners universales («35A/36A/78A/85A UNIVERSAL») son UN producto ASTA
 * enlazado a varios originales. Cada original lleva aquí solo sus impresoras,
 * como en la caja: juntarlas todas en cada código diría que el CE285A original
 * le sirve a una P1006, y no es así.
 *
 * Erratas del PDF, corregidas o fuera:
 *
 *   · «M212/214/217/219» y «M130/M132/M139» del 85A son las M1212… y M1130…
 *     (lo dice la caja del universal).
 *   · «W 20222A» es el W2022A; «MF642/641/463…» del 054, la MF643; «M202» del
 *     MLT-D111S, suelto entre la M2022 y la M2026, no se carga.
 *   · Fuera: la M3025 del 51A y la MF3030 del 125 (no existen con ese
 *     nombre), la «450» del 104 (no se sabe cuál es) y la M275 del 131A (usa
 *     el 126A, que también la trae).
 *   · El 126A no se enlaza por su número comercial: en la base es el tambor.
 */

const FUENTE = 'Lista ASTA Toner Venezuela (distribuidor OSC), PDF recibido el 2026-10-26';
const RECIBIDA = '2026-10-26';

const lista = (marca: string, cartuchos: string[], impresoras: string[]): ListaFabricante => ({
  marca,
  cartuchos,
  impresoras,
  fuentes: [FUENTE],
  consultado: RECIBIDA,
});

export const LISTA_ASTA: ListaFabricante[] = [
  // ── HP ─────────────────────────────────────────────────────────────────────
  lista('HP', ['W1510X', '151X'], ['LaserJet Pro 4003', 'LaserJet Pro MFP 4103']),
  lista('HP', ['W1360A', '136A'], [
    'LaserJet M208',
    'LaserJet M209',
    'LaserJet M211',
    'LaserJet MFP M232',
    'LaserJet MFP M233',
    'LaserJet MFP M234',
    'LaserJet MFP M236',
  ]),
  lista('HP', ['W1105A', '105A'], ['Laser 107', 'Laser 135', 'Laser 137']),
  lista('HP', ['W1105X'], ['Laser 107', 'Laser 135', 'Laser 137']),
  lista('HP', ['W1103A', '103A'], ['Neverstop 1000a', 'Neverstop 1200a']),
  lista('HP', ['Q2612A', '12A'], [
    'LaserJet 1010',
    'LaserJet 1012',
    'LaserJet 1015',
    'LaserJet 1018',
    'LaserJet 1020',
    'LaserJet 1022',
    'LaserJet 3015',
    'LaserJet 3020',
    'LaserJet 3030',
    'LaserJet 3050',
    'LaserJet 3052',
    'LaserJet 3055',
    'LaserJet M1319f',
    'LaserJet M1005',
  ]),
  lista('HP', ['W1500A', '150A'], ['LaserJet M111a', 'LaserJet M111w', 'LaserJet MFP M141w']),
  lista('HP', ['Q7553A', '53A'], ['LaserJet P2014', 'LaserJet P2015', 'LaserJet M2727']),
  lista('HP', ['Q5949A', '49A'], ['LaserJet 1160', 'LaserJet 1320', 'LaserJet M3390mfp', 'LaserJet M3392mfp']),
  lista('HP', ['Q7551A', '51A'], ['LaserJet P3005', 'LaserJet M3027']),
  // «Q5942X/Q5945»: un ASTA para las cuatro. El original de la 4345 es el
  // Q5945A, que no está en el sistema; el ASTA 42X le sirve (lo confirmó
  // Supricom el 2026-10-26), así que va también con el Q5942X para que el
  // kiosco la recomiende. Cuando exista el Q5945A, se enlaza con el suyo.
  lista('HP', ['Q5942X', '42X'], ['LaserJet 4240', 'LaserJet 4250', 'LaserJet 4350', 'LaserJet 4345']),
  lista('HP', ['Q5945A', '45A'], ['LaserJet 4345']),
  lista('HP', ['CF283A', '83A'], ['LaserJet Pro MFP M125', 'LaserJet Pro MFP M127', 'LaserJet Pro M201', 'LaserJet Pro MFP M225']),
  lista('HP', ['CF280A', '80A'], ['LaserJet Pro 400 M401', 'LaserJet Pro 400 MFP M425']),
  lista('HP', ['CE505A', '05A'], [
    'LaserJet P2030',
    'LaserJet P2033',
    'LaserJet P2034',
    'LaserJet P2035',
    'LaserJet P2036',
    'LaserJet P2037',
    'LaserJet P2050',
    'LaserJet P2053',
    'LaserJet P2054',
    'LaserJet P2055',
    'LaserJet P2056',
    'LaserJet P2057',
  ]),
  lista('HP', ['CF279A', '79A'], ['LaserJet Pro M12', 'LaserJet Pro MFP M26']),
  lista('HP', ['CF248A', '48A'], [
    'LaserJet Pro MFP M28',
    'LaserJet Pro MFP M29',
    'LaserJet Pro MFP M31',
    'LaserJet Pro M14',
    'LaserJet Pro M15',
    'LaserJet Pro M16',
  ]),
  lista('HP', ['CF230A', '30A'], ['LaserJet Pro M203', 'LaserJet Pro MFP M227', 'LaserJet Ultra M206', 'LaserJet Ultra MFP M230']),
  lista('HP', ['CF226A', '26A'], ['LaserJet Pro M402', 'LaserJet Pro MFP M426']),
  lista('HP', ['CF217A', '17A'], ['LaserJet Pro M102', 'LaserJet Pro MFP M130', 'LaserJet Pro MFP M130fw']),
  lista('HP', ['CF258A', '58A'], ['LaserJet Pro M404', 'LaserJet Pro MFP M428']),
  lista('HP', ['CF258X', '58X'], ['LaserJet Pro M404', 'LaserJet Pro MFP M428']),
  lista('HP', ['CF219A', '19A'], ['LaserJet Pro M104', 'LaserJet Pro MFP M132']),
  lista('HP', ['CE255A', '55A'], ['LaserJet P3010', 'LaserJet P3015', 'LaserJet P3016', 'LaserJet Pro M521', 'LaserJet MFP M525c']),

  // Color: los cuatro colores de una serie, con las mismas impresoras.
  lista('HP', ['CF510A', 'CF511A', 'CF512A', 'CF513A', '204A'], ['Color LaserJet Pro M154', 'Color LaserJet Pro MFP M180', 'Color LaserJet Pro MFP M181']),
  lista('HP', ['W2020A', 'W2021A', 'W2022A', 'W2023A', '414A'], ['Color LaserJet Pro M454', 'Color LaserJet Pro MFP M479']),
  lista('HP', ['W2310A', 'W2311A', 'W2312A', 'W2313A', '215A'], ['Color LaserJet Pro M155', 'Color LaserJet Pro MFP M182', 'Color LaserJet Pro MFP M183']),
  lista('HP', ['CE410A', 'CE411A', 'CE412A', 'CE413A', '305A'], [
    'LaserJet Pro 300 Color M351',
    'LaserJet Pro 300 Color MFP M375',
    'LaserJet Pro 400 Color M451',
    'LaserJet Pro 400 Color MFP M475',
  ]),
  lista('HP', ['CF500A', 'CF501A', 'CF502A', 'CF503A', '202A'], ['Color LaserJet Pro M254', 'Color LaserJet Pro MFP M280', 'Color LaserJet Pro MFP M281']),
  lista('HP', ['CE320A', 'CE321A', 'CE322A', 'CE323A', '128A'], ['LaserJet Pro CP1525', 'LaserJet Pro CM1415fnw']),
  lista('HP', ['CB540A', 'CB541A', 'CB542A', 'CB543A', '125A'], [
    'Color LaserJet CM1300',
    'Color LaserJet CM1312',
    'Color LaserJet CP1210',
    'Color LaserJet CP1215',
    'Color LaserJet CP1515',
    'Color LaserJet CP1518',
  ]),
  lista('HP', ['CF210A', 'CF211A', 'CF212A', 'CF213A', '131A'], ['LaserJet Pro 200 Color M251', 'LaserJet Pro 200 Color MFP M276']),
  lista('HP', ['CE310A', 'CE311A', 'CE312A', 'CE313A'], ['LaserJet Pro CP1025', 'LaserJet Pro 100 Color MFP M175', 'TopShot LaserJet Pro M275']),
  lista('HP', ['CF350A', 'CF351A', 'CF352A', 'CF353A', '130A'], ['Color LaserJet Pro MFP M176', 'Color LaserJet Pro MFP M177']),

  // Universal 35A/36A/78A/85A: las impresoras de cada original, como en la caja.
  lista('HP', ['CB435A', '35A'], ['LaserJet P1002', 'LaserJet P1003', 'LaserJet P1004', 'LaserJet P1005', 'LaserJet P1006', 'LaserJet P1009']),
  lista('HP', ['CB436A', '36A'], ['LaserJet P1503', 'LaserJet P1504', 'LaserJet P1505', 'LaserJet P1506', 'LaserJet M1120', 'LaserJet M1522']),
  lista('HP', ['CE278A', '78A'], [
    'LaserJet Pro P1560',
    'LaserJet Pro P1566',
    'LaserJet Pro P1567',
    'LaserJet Pro P1568',
    'LaserJet Pro P1569',
    'LaserJet Pro P1600',
    'LaserJet Pro P1601',
    'LaserJet Pro P1602',
    'LaserJet Pro P1605',
    'LaserJet Pro P1606dn',
    'LaserJet Pro P1607dn',
    'LaserJet Pro P1608dn',
    'LaserJet Pro P1609dn',
    'LaserJet Pro M1530',
    'LaserJet Pro M1536dnf',
    'LaserJet Pro M1537',
    'LaserJet Pro M1538',
    'LaserJet Pro M1539dnf',
  ]),
  lista('HP', ['CE285A', '85A'], [
    'LaserJet Pro P1100',
    'LaserJet P1102',
    'LaserJet P1102w',
    'LaserJet Pro P1105',
    'LaserJet Pro P1109',
    'LaserJet Pro M1212nf',
    'LaserJet Pro M1214',
    'LaserJet Pro M1217',
    'LaserJet Pro M1219',
    'LaserJet Pro M1130',
    'LaserJet Pro M1132',
    'LaserJet Pro M1139',
  ]),

  // ── Samsung ────────────────────────────────────────────────────────────────
  lista('Samsung', ['MLT-D111S'], [
    'Xpress M2020',
    'Xpress M2021',
    'Xpress M2022',
    'Xpress M2026',
    'Xpress M2028',
    'Xpress M2070',
    'Xpress M2071',
    'Xpress M2074',
    'Xpress M2078',
  ]),
  lista('Samsung', ['MLT-D105S'], [
    'ML-1910',
    'ML-1911',
    'ML-1915',
    'ML-1916',
    'ML-2525',
    'ML-2526',
    'ML-2540',
    'ML-2541',
    'ML-2545',
    'ML-2547',
    'ML-2580',
    'ML-2581',
    'SCX-4600',
    'SCX-4601',
    'SCX-4605',
    'SCX-4610',
    'SCX-4622',
    'SCX-4623',
    'CF-650',
    'CF-651',
  ]),
  lista('Samsung', ['MLT-D104S'], [
    'ML-1660',
    'ML-1665',
    'ML-1670',
    'ML-1673',
    'ML-1674',
    'ML-1675',
    'ML-1678',
    'ML-1860',
    'ML-1861',
    'ML-1865',
    'SCX-3200',
    'SCX-3205',
    'SCX-3217',
  ]),
  lista('Samsung', ['MLT-D101S'], [
    'ML-2160',
    'ML-2161',
    'ML-2162',
    'ML-2165',
    'ML-2166',
    'ML-2168',
    'SCX-3400',
    'SCX-3401',
    'SCX-3405',
    'SCX-3406',
    'SF-760P',
    'SF-761P',
  ]),

  // ── Canon ──────────────────────────────────────────────────────────────────
  lista('Canon', ['CRG-104'], [
    'imageCLASS MF4010',
    'imageCLASS MF4120',
    'imageCLASS MF4130',
    'imageCLASS MF4150',
    'imageCLASS MF4270',
    'imageCLASS MF4330',
    'imageCLASS MF4350',
    'imageCLASS MF4370',
    'imageCLASS MF4380',
    'FAXPHONE MF4680',
  ]),
  lista('Canon', ['GPR-22'], [
    'imageRUNNER 1018',
    'imageRUNNER 1019',
    'imageRUNNER 1020',
    'imageRUNNER 1022',
    'imageRUNNER 1023',
    'imageRUNNER 1024',
    'imageRUNNER 1025',
  ]),
  // El 055 es un solo código para los cuatro colores.
  lista('Canon', ['CRG-055'], [
    'i-SENSYS LBP662',
    'i-SENSYS LBP663',
    'i-SENSYS LBP664',
    'imageCLASS MF740',
    'imageCLASS MF741',
    'imageCLASS MF742',
    'imageCLASS MF743',
    'imageCLASS MF744',
    'imageCLASS MF745',
    'imageCLASS MF746',
  ]),
  lista('Canon', ['CRG-057H'], [
    'i-SENSYS LBP220',
    'i-SENSYS LBP221',
    'i-SENSYS LBP223',
    'i-SENSYS LBP224',
    'i-SENSYS LBP226',
    'i-SENSYS LBP227',
    'i-SENSYS LBP228x',
    'i-SENSYS MF440',
    'i-SENSYS MF441',
    'i-SENSYS MF443',
    'i-SENSYS MF445',
    'i-SENSYS MF446',
    'i-SENSYS MF448',
    'i-SENSYS MF449x',
    'imageCLASS MF455',
  ]),
  lista('Canon', ['CRG-051'], [
    'imageCLASS LBP161dn',
    'imageCLASS LBP162',
    'imageCLASS MF263',
    'imageCLASS MF264',
    'imageCLASS MF267',
    'imageCLASS MF269',
  ]),
  lista('Canon', ['CRG-052'], [
    'i-SENSYS LBP212',
    'imageCLASS LBP214',
    'imageCLASS LBP215',
    'i-SENSYS MF421',
    'imageCLASS MF424',
    'imageCLASS MF426',
    'i-SENSYS MF428',
    'imageCLASS MF429',
  ]),
  lista('Canon', ['CRG-054'], [
    'imageCLASS MF641',
    'imageCLASS MF642',
    'imageCLASS MF643',
    'imageCLASS MF644',
    'imageCLASS MF645',
    'imageCLASS LBP621',
    'imageCLASS LBP622',
  ]),
  lista('Canon', ['CRG-128'], [
    'imageCLASS MF4450',
    'imageCLASS MF4452',
    'imageCLASS MF4550',
    'imageCLASS MF4570',
    'imageCLASS MF4770',
    'imageCLASS MF4880',
    'imageCLASS D530',
    'imageCLASS D550',
    'FAXPHONE L100',
    'FAXPHONE L190',
  ]),
  lista('Canon', ['CRG-125'], ['LBP6000', 'LBP6018', 'LBP6020', 'imageCLASS LBP6030', 'imageCLASS MF3010']),
];
