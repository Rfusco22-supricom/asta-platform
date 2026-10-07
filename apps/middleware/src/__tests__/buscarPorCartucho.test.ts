import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { buscarImpresoras, codigoDeCartuchoBuscado, vaciarCachesRecomendador } from '../services/recomendador/recomendador.service.js';

/**
 * El kiosco también busca por el código del tóner: quien trae el cartucho vacío
 * en la mano y no sabe el modelo de su impresora.
 */

describe('codigoDeCartuchoBuscado', () => {
  it('quita la marca y las palabras de alrededor', () => {
    expect(codigoDeCartuchoBuscado('105A')).toBe('105a');
    expect(codigoDeCartuchoBuscado('hp 105a')).toBe('105a');
    expect(codigoDeCartuchoBuscado('Tóner HP 105A original')).toBe('105a');
    expect(codigoDeCartuchoBuscado('CRG 051H')).toBe('051h');
    expect(codigoDeCartuchoBuscado('TN-760')).toBe('tn760');
  });

  it('lo que no parece un código, no', () => {
    expect(codigoDeCartuchoBuscado('hp')).toBeNull();
    expect(codigoDeCartuchoBuscado('tóner negro')).toBeNull();
    expect(codigoDeCartuchoBuscado('12')).toBeNull();
  });
});

describe('Buscar por cartucho, contra MySQL', () => {
  const MARCA = 'ZZ_BUSCARTUCHO';
  let marcaId = 0;
  let cartucho = 0;
  let cartuchoXl = 0;
  const impresora: Record<string, number> = {};

  beforeAll(async () => {
    if (await prisma.printerBrand.count({ where: { name: MARCA } })) throw new Error(`Restos de ${MARCA}: límpialos a mano.`);
    marcaId = (await prisma.printerBrand.create({ data: { name: MARCA } })).id;
    cartucho = (await prisma.cartridge.create({ data: { brandId: marcaId, code: 'QZ-9871', codeNormalized: 'qz9871', kind: 'TONER' } })).id;
    cartuchoXl = (await prisma.cartridge.create({ data: { brandId: marcaId, code: 'QZ-9872XL', codeNormalized: 'qz9872xl', kind: 'TINTA' } })).id;
    for (const n of ['QZP 100', 'QZP 200', 'QZP 300']) {
      impresora[n] = (await prisma.printerModel.create({ data: { brandId: marcaId, name: n, nameNormalized: n.toLowerCase().replace(/\s/g, '') } })).id;
    }
    await prisma.cartridgePrinterModel.createMany({
      data: [
        { cartridgeId: cartucho, printerModelId: impresora['QZP 200']!, source: 'FABRICANTE', status: 'VALIDADA' },
        { cartridgeId: cartucho, printerModelId: impresora['QZP 100']!, source: 'FABRICANTE', status: 'VALIDADA' },
        // Sin revisar: no lleva a nadie a esta impresora.
        { cartridgeId: cartucho, printerModelId: impresora['QZP 300']!, source: 'PARSEO', status: 'PROPUESTA' },
        { cartridgeId: cartuchoXl, printerModelId: impresora['QZP 300']!, source: 'FABRICANTE', status: 'VALIDADA' },
      ],
    });
  });

  beforeEach(() => vaciarCachesRecomendador());

  afterAll(async () => {
    if (marcaId) {
      await prisma.cartridge.deleteMany({ where: { brandId: marcaId } });
      await prisma.printerModel.deleteMany({ where: { brandId: marcaId } });
      await prisma.printerBrand.delete({ where: { id: marcaId } });
    }
    vaciarCachesRecomendador();
    await prisma.$disconnect();
  });

  const nombres = async (q: string) => (await buscarImpresoras(q, 10)).impresoras.map((i) => i.nombre);

  it('el código del tóner lleva a sus impresoras validadas, en orden', async () => {
    expect(await nombres('qz-9871')).toEqual(['QZP 100', 'QZP 200']);
    expect(await nombres('tóner QZ 9871')).toEqual(['QZP 100', 'QZP 200']);
  });

  it('sin el sufijo de tamaño también: «QZ-9872» es el QZ-9872XL', async () => {
    expect(await nombres('QZ-9872')).toEqual(['QZP 300']);
  });

  it('un modelo de impresora gana: el cartucho solo se mira si no hubo ninguno', async () => {
    expect(await nombres('QZP 200')).toEqual(['QZP 200']);
  });

  it('con el cartucho no salen sugerencias', async () => {
    expect((await buscarImpresoras('qz9871', 10)).sugerencias).toEqual([]);
  });
});
