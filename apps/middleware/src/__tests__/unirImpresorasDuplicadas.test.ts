import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { buscarImpresora } from '../services/recomendador/impresoraExistente.js';
import { normalizarModelo } from '../services/recomendador/normalizar.js';
import { agruparDuplicadas, unirEn, type ImpresoraParaUnir } from '../services/recomendador/unirImpresorasDuplicadas.js';

/**
 * #173 · Los duplicados que ya estaban antes del arreglo, en una sola impresora.
 *
 * Los nombres son los de los 25 pares que había en producción el 5 de octubre.
 */

let id = 0;
const imp = (marca: string, name: string, inOdooCatalog = false): ImpresoraParaUnir => ({
  id: ++id,
  brandId: { HP: 1, Canon: 2, Epson: 3 }[marca] ?? 9,
  marca,
  name,
  nameNormalized: normalizarModelo(name),
  inOdooCatalog,
});
const nombres = (g: { queda: ImpresoraParaUnir; sobran: ImpresoraParaUnir[] }) => [g.queda.name, ...g.sobran.map((s) => s.name)];

describe('agruparDuplicadas', () => {
  it.each([
    ['Epson', 'L1110', 'EcoTank L1110'],
    ['Canon', 'MF741', 'imageCLASS MF741'],
    ['Canon', 'LBP663', 'I-SENSYS LBP663'],
    ['HP', '4103', 'LaserJet Pro MFP 4103'],
    ['HP', '2875', 'DeskJet Ink Advantage 2875'],
    ['HP', '107W', 'Laser 107w'],
    ['HP', 'MFP M525c', 'LaserJet MFP M525c'],
    ['Canon', '1643I II', 'IR1643I II'],
  ])('%s «%s» y «%s» son una, y se queda la del nombre largo', (marca, corta, larga) => {
    const { unir, dudosos } = agruparDuplicadas([imp(marca, corta, true), imp(marca, larga)]);
    expect(dudosos).toEqual([]);
    expect(unir.map(nombres)).toEqual([[larga, corta]]);
  });

  it('otro modelo, otra marca o un número que no identifica: no se unen', () => {
    const { unir } = agruparDuplicadas([
      imp('HP', 'LaserJet Pro M404dn'),
      imp('HP', 'M404'),
      imp('Epson', 'EcoTank L3110'),
      imp('Epson', 'L3150'),
      imp('HP', 'Smart Tank 580', true),
      imp('HP', '580'),
      imp('Canon', 'MF741'),
      imp('HP', 'MF741'),
    ]);
    expect(unir).toEqual([]);
  });

  it('tres que son la misma de dos en dos: un grupo', () => {
    const { unir } = agruparDuplicadas([imp('HP', 'M132'), imp('HP', 'MFP M132'), imp('HP', 'LaserJet Pro MFP M132')]);
    expect(unir.map(nombres)).toEqual([['LaserJet Pro MFP M132', 'M132', 'MFP M132']]);
  });

  it('enlazadas por una pero distintas entre ellas: dudoso, no se toca', () => {
    // Las dos acaban en «M132», pero ninguna acaba en la otra.
    const { unir, dudosos } = agruparDuplicadas([imp('HP', 'M132'), imp('HP', 'LaserJet M132'), imp('HP', 'MFP M132')]);
    expect(unir).toEqual([]);
    expect(dudosos.map((g) => g.map((i) => i.name).sort())).toEqual([['LaserJet M132', 'M132', 'MFP M132']]);
  });
});

describe('unirEn, contra MySQL', () => {
  const MARCA = 'ZZUnir';
  let marcaId = 0;
  let larga = 0;
  let corta = 0;
  let otraCorta = 0;
  const cartucho: Record<string, number> = {};

  beforeAll(async () => {
    if (await prisma.printerBrand.findFirst({ where: { name: MARCA } })) throw new Error(`Ya hay una marca ${MARCA}: bórrala a mano.`);
    marcaId = (await prisma.printerBrand.create({ data: { name: MARCA } })).id;
    const crear = async (name: string, inOdooCatalog = false) =>
      (await prisma.printerModel.create({ data: { brandId: marcaId, name, nameNormalized: normalizarModelo(name), inOdooCatalog } })).id;
    larga = await crear('EcoTank ZZ9951');
    corta = await crear('ZZ9951', true);
    otraCorta = await crear('PRO ZZ9952');
    await crear('ZZ9952');
    for (const c of ['A', 'B', 'C', 'D']) {
      cartucho[c] = (await prisma.cartridge.create({ data: { brandId: marcaId, code: `ZZ995${c}`, codeNormalized: `zz995${c.toLowerCase()}`, kind: 'TONER' } })).id;
    }
    const enlazar = (cartridgeId: number, printerModelId: number, status: 'PROPUESTA' | 'VALIDADA' | 'RECHAZADA' = 'PROPUESTA') =>
      prisma.cartridgePrinterModel.create({ data: { cartridgeId, printerModelId, source: 'PARSEO', status } });
    // A solo en la corta: se mueve. B en las dos, revisada solo en la corta: se queda la revisión.
    await enlazar(cartucho.A!, corta);
    await enlazar(cartucho.B!, larga);
    await enlazar(cartucho.B!, corta, 'VALIDADA');
    await prisma.printerModelAlias.create({ data: { printerModelId: corta, alias: 'ZZ9951X', aliasNormalized: 'zz9951x', source: 'BUSQUEDA' } });
    // El otro par, con el mismo tóner validado en una y rechazado en otra: conflicto.
    const conflictiva = (await prisma.printerModel.findFirstOrThrow({ where: { brandId: marcaId, name: 'ZZ9952' } })).id;
    await enlazar(cartucho.C!, otraCorta, 'VALIDADA');
    await enlazar(cartucho.C!, conflictiva, 'RECHAZADA');
  });

  afterAll(async () => {
    if (marcaId) {
      await prisma.cartridge.deleteMany({ where: { brandId: marcaId } });
      await prisma.printerModel.deleteMany({ where: { brandId: marcaId } });
      await prisma.printerBrand.delete({ where: { id: marcaId } });
    }
    await prisma.$disconnect();
  });

  it('une el par, deja el conflicto como estaba, y repetirlo no cambia nada', async () => {
    const r = await prisma.$transaction((tx) => unirEn(tx, { brandId: marcaId }));
    expect(r.grupos).toEqual([{ marca: MARCA, queda: 'EcoTank ZZ9951', sobran: ['ZZ9951'], tonersMovidos: 1, tonersRepetidos: 1, alias: 2 }]);
    expect(r.conflictos).toEqual([{ marca: MARCA, impresoras: ['PRO ZZ9952', 'ZZ9952'], cartucho: 'ZZ995C' }]);

    const queda = await prisma.printerModel.findUniqueOrThrow({ where: { id: larga }, include: { cartridges: true, aliases: true } });
    expect(queda.isActive).toBe(true);
    // Era del catálogo la que sobra: ahora lo es la que se queda.
    expect(queda.inOdooCatalog).toBe(true);
    expect(queda.cartridges.map((c) => [c.cartridgeId, c.status]).sort()).toEqual(
      [[cartucho.A, 'PROPUESTA'], [cartucho.B, 'VALIDADA']].sort(),
    );
    expect(queda.aliases.map((a) => a.aliasNormalized).sort()).toEqual(['zz9951', 'zz9951x']);

    // La fila repetida no se borra (producción no tiene DELETE): se queda con la desactivada.
    const sobra = await prisma.printerModel.findUniqueOrThrow({ where: { id: corta }, include: { cartridges: true } });
    expect(sobra.isActive).toBe(false);
    expect(sobra.cartridges.map((c) => c.cartridgeId)).toEqual([cartucho.B]);
    // El conflicto, intacto.
    expect(await prisma.printerModel.count({ where: { brandId: marcaId, isActive: true } })).toBe(3);

    const otra = await prisma.$transaction((tx) => unirEn(tx, { brandId: marcaId }));
    expect(otra.grupos).toEqual([]);
  });

  it('un importador que vuelve a traer el nombre corto va a la que se quedó', async () => {
    const encontrada = await prisma.$transaction((tx) => buscarImpresora(tx, marcaId, 'zz9951'));
    expect(encontrada?.id).toBe(larga);
  });

  it('una desactivada sin alias sigue siendo ella: la retiró alguien', async () => {
    await prisma.printerModel.update({ where: { id: otraCorta }, data: { isActive: false } });
    const encontrada = await prisma.$transaction((tx) => buscarImpresora(tx, marcaId, normalizarModelo('PRO ZZ9952')));
    expect(encontrada?.id).toBe(otraCorta);
  });
});
