import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { buscarImpresora, claveDelCatalogo, esLaDelCatalogo, esLaMisma } from '../services/recomendador/impresoraExistente.js';

/**
 * #40 · Una impresora del catálogo de Odoo no se duplica cuando otro la nombra distinto.
 *
 * En producción el catálogo se importó ANTES que los tóners: sin esto, «L3250»
 * de un tóner creaba otra impresora al lado de «EcoTank L3250», y el kiosco
 * enseñaba dos. Los casos de abajo son los tres que pasan con los datos de hoy.
 */

describe('esLaDelCatalogo', () => {
  it.each([
    ['HP', 'LaserJet Pro MFP M428FDW', 'mfpm428fdw'],
    ['Epson', 'WorkForce Pro C5310', 'workforcewfc5310'],
    ['Epson', 'EcoTank L3250', 'l3250'],
    ['HP', 'Smart Tank 580', 'smarttank580'],
  ])('%s %s es «%s»', (marca, nombre, nuevo) => {
    expect(esLaDelCatalogo(nuevo, claveDelCatalogo(marca, nombre)!)).toBe(true);
  });

  it.each([
    // Otro sufijo es otra impresora.
    ['HP', 'LaserJet Pro MFP M428FDW', 'mfpm428fdn'],
    // Una clave que empieza por cifras no se busca al final de otro nombre:
    // «107w» sería el final de demasiados modelos.
    ['HP', '107W', 'laserjet1107w'],
    // Solo cifras: «580» no es la Smart Tank 580.
    ['HP', 'Smart Tank 580', '580'],
  ])('%s %s NO es «%s»', (marca, nombre, nuevo) => {
    expect(esLaDelCatalogo(nuevo, claveDelCatalogo(marca, nombre)!)).toBe(false);
  });
});

/**
 * #173 · Y cuando NINGUNA de las dos es del catálogo: la L3110 no la vendemos,
 * así que la lista del fabricante crea «EcoTank L3110» y el nombre de un tóner,
 * «L3110». Eran 12 pares duplicados de 298 impresoras.
 */
describe('esLaMisma', () => {
  it.each([
    ['ecotankl3110', 'l3110'],
    ['l3110', 'ecotankl3110'],
    ['laserjetprom404dn', 'm404dn'],
    ['laserjetpromfpm428fdn', 'mfpm428fdn'],
    ['laser107w', '107w'],
    ['deskjetinkadvantage2874', '2874'],
    ['ir1643iii', '1643iii'],
  ])('«%s» y «%s» son la misma', (a, b) => {
    expect(esLaMisma(a, b)).toBe(true);
  });

  it.each([
    // Acabar en, no contener: la M404 es otro modelo que la M404dn.
    ['laserjetprom404dn', 'm404'],
    // Sin cifras no se arriesga, aunque uno acabe en el otro: «Color LaserJet»
    // es una familia entera, no la misma impresora que «LaserJet».
    ['colorlaserjet', 'laserjet'],
    ['laserjet', 'laser'],
    // Menos de cuatro: «107» seria el final de demasiados modelos.
    ['laser107', '107'],
    // El mismo nombre no es un duplicado: eso lo resuelve la busqueda exacta.
    ['l3110', 'l3110'],
    // Otro sufijo es otra impresora.
    ['ecotankl3110', 'l3150'],
  ])('«%s» y «%s» NO', (a, b) => {
    expect(esLaMisma(a, b)).toBe(false);
  });
});

describe('buscarImpresora, contra MySQL', () => {
  const DEL_TEST = { nameNormalized: { contains: 'zz994' } };
  let comprobado = false;
  let marcaCreadaPorElTest = false;
  let hp = 0;
  let delCatalogo = 0;

  beforeAll(async () => {
    if (await prisma.printerModel.count({ where: DEL_TEST })) throw new Error('Ya hay impresoras ZZ994…: límpialas a mano.');
    comprobado = true;
    let marca = await prisma.printerBrand.findFirst({ where: { name: 'HP' } });
    if (!marca) {
      marca = await prisma.printerBrand.create({ data: { name: 'HP' } });
      marcaCreadaPorElTest = true;
    }
    hp = marca.id;
    const crear = (name: string, inOdooCatalog: boolean) =>
      prisma.printerModel.create({ data: { brandId: hp, name, nameNormalized: name.toLowerCase().replace(/[^a-z0-9]/g, ''), inOdooCatalog } });
    delCatalogo = (await crear('LaserJet Pro MFP ZZ9940FDW', true)).id;
    // Dos del catálogo que acaban igual: no se elige ninguna.
    await crear('LaserJet ZZ9942DW', true);
    await crear('Color LaserJet ZZ9942DW', true);
    // No es del catálogo: desde #173 también se reconoce por el nombre.
    await crear('LaserJet ZZ9943W', false);
    // Dos que no son del catálogo y acaban igual: no se elige ninguna.
    await crear('LaserJet ZZ9944DW', false);
    await crear('Color LaserJet ZZ9944DW', false);
  });

  afterAll(async () => {
    if (comprobado) {
      await prisma.printerModel.deleteMany({ where: DEL_TEST });
      if (marcaCreadaPorElTest) await prisma.printerBrand.deleteMany({ where: { id: hp, printerModels: { none: {} }, cartridges: { none: {} } } });
    }
    await prisma.$disconnect();
  });

  const buscar = (nombreNormalizado: string) => prisma.$transaction((tx) => buscarImpresora(tx, hp, nombreNormalizado));

  it('el nombre exacto, como siempre', async () => {
    expect((await buscar('laserjetzz9943w'))?.name).toBe('LaserJet ZZ9943W');
  });

  it('la del catálogo con otro nombre', async () => {
    expect((await buscar('mfpzz9940fdw'))?.id).toBe(delCatalogo);
    expect((await buscar('zz9940fdw'))?.id).toBe(delCatalogo);
  });

  it('nada si es otro modelo o si hay dos candidatas', async () => {
    expect(await buscar('mfpzz9940fdn')).toBeNull();
    expect(await buscar('zz9942dw')).toBeNull();
    expect(await buscar('zz9944dw')).toBeNull();
  });

  it('#173 · la que ya existe con otro nombre, aunque no sea del catálogo', async () => {
    // Es el caso de «EcoTank L3110» y «L3110»: ninguna de las dos se vende.
    // El nombre nuevo es el corto, como cuando el parseo escribe «L3110».
    expect((await buscar('zz9943w'))?.name).toBe('LaserJet ZZ9943W');
    // Y al revés: el nuevo es el largo, como «EcoTank L3110» sobre «L3110».
    expect((await buscar('prolaserjetzz9943w'))?.name).toBe('LaserJet ZZ9943W');
    // Pero dos prefijos distintos NO son la misma: ninguno acaba en el otro.
    expect(await buscar('ecotankzz9943w')).toBeNull();
  });
});
