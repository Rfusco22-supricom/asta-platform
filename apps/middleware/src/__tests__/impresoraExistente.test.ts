import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { buscarImpresora, claveDelCatalogo, esLaDelCatalogo } from '../services/recomendador/impresoraExistente.js';

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
    // No es del catálogo: solo se encuentra con el nombre exacto, como antes.
    await crear('LaserJet ZZ9943W', false);
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

  it('nada si es otro modelo, si hay dos candidatas o si la que se parece no es del catálogo', async () => {
    expect(await buscar('mfpzz9940fdn')).toBeNull();
    expect(await buscar('zz9942dw')).toBeNull();
    expect(await buscar('zz9943w')).toBeNull();
  });
});
