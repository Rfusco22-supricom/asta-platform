import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { unirCartuchosEpson } from '../services/recomendador/unirCartuchosEpson.js';

/**
 * #56 · Las botellas Epson sin T se juntan con las que la llevan.
 *
 * Códigos INVENTADOS (991, 992, que Epson no usa) y plantillas 3.850.000.000+,
 * sobre la marca Epson de verdad: la unión solo mira cartuchos de Epson.
 *
 * Lo que se vigila:
 *
 *   · los enlaces del "991" pasan al "T991", tal como estaban (nada se valida);
 *   · si el enlace ya estaba en el "T991", manda el del T991;
 *   · el "991" no se borra (asta_app no tiene DELETE): queda como RETIRADO-991;
 *   · sin "T992", el "992" se renombra;
 *   · el simulacro no escribe, y repetir no encuentra nada.
 */

const PLANTILLA = 3_850_000_000;
const CODIGOS = ['991', 't991', '992', 't992', 'retirado991'];
let epson = 0;
let impresora = 0;
let comprobado = false;

const limpiar = async () => {
  await prisma.cartridge.deleteMany({ where: { brandId: epson, codeNormalized: { in: CODIGOS } } });
  await prisma.printerModel.deleteMany({ where: { nameNormalized: 'zzepsonunir1' } });
};

beforeAll(async () => {
  const marca = await prisma.printerBrand.findFirst({ where: { name: 'Epson' } });
  epson = marca?.id ?? (await prisma.printerBrand.create({ data: { name: 'Epson' } })).id;
  if (await prisma.cartridge.count({ where: { brandId: epson, codeNormalized: { in: CODIGOS } } })) throw new Error('Restos de cartuchos Epson 991/992: límpialos a mano.');
  comprobado = true;
  impresora = (await prisma.printerModel.create({ data: { brandId: epson, name: 'ZZ Epson Unir 1', nameNormalized: 'zzepsonunir1' } })).id;
});

afterAll(async () => {
  if (comprobado) await limpiar();
  await prisma.$disconnect();
});

describe('#56 · Botellas Epson sin T', () => {
  it('pasa los enlaces al de la T, respeta lo que ya estaba allí, y renombra lo que no tiene pareja', async () => {
    const sinT = await prisma.cartridge.create({ data: { brandId: epson, code: '991', codeNormalized: '991', kind: 'TINTA' } });
    const conT = await prisma.cartridge.create({ data: { brandId: epson, code: 'T991', codeNormalized: 't991', kind: 'TINTA' } });
    const solo = await prisma.cartridge.create({ data: { brandId: epson, code: '992', codeNormalized: '992', kind: 'TINTA' } });
    // El ASTA, propuesto contra el 991; el original, validado en el T991 y también (repetido) en el 991.
    await prisma.productCartridge.createMany({
      data: [
        { odooProductTmplId: PLANTILLA, cartridgeId: sinT.id, relation: 'COMPATIBLE', source: 'PARSEO', status: 'PROPUESTA', evidence: '991BK' },
        { odooProductTmplId: PLANTILLA + 1, cartridgeId: sinT.id, relation: 'ORIGINAL', source: 'PARSEO', status: 'PROPUESTA' },
        { odooProductTmplId: PLANTILLA + 1, cartridgeId: conT.id, relation: 'ORIGINAL', source: 'PARSEO', status: 'VALIDADA' },
      ],
    });
    await prisma.cartridgePrinterModel.create({ data: { cartridgeId: conT.id, printerModelId: impresora, source: 'FABRICANTE', status: 'VALIDADA' } });

    const simulado = await unirCartuchosEpson({ aplicar: false });
    expect(await prisma.cartridge.count({ where: { id: sinT.id } })).toBe(1);

    const r = await unirCartuchosEpson({ aplicar: true });
    expect(simulado).toEqual(r);
    expect(r.unidos).toContainEqual({ de: '991', a: 'T991', productos: 1, impresoras: 0, repetidos: 1, retirado: 'RETIRADO-991' });
    expect(r.renombrados).toContainEqual({ de: '992', a: 'T992' });

    // Retirado, no borrado; con el enlace repetido, que no se tocó.
    expect(await prisma.cartridge.findUnique({ where: { id: sinT.id } })).toMatchObject({ code: 'RETIRADO-991', codeNormalized: 'retirado991' });
    expect(await prisma.productCartridge.findMany({ where: { cartridgeId: sinT.id }, select: { odooProductTmplId: true, status: true } })).toEqual([
      { odooProductTmplId: PLANTILLA + 1, status: 'PROPUESTA' },
    ]);
    const enT = await prisma.productCartridge.findMany({ where: { cartridgeId: conT.id }, orderBy: { odooProductTmplId: 'asc' } });
    expect(enT.map((p) => [p.odooProductTmplId, p.status, p.evidence])).toEqual([
      [PLANTILLA, 'PROPUESTA', '991BK'],
      [PLANTILLA + 1, 'VALIDADA', null],
    ]);
    expect(await prisma.cartridge.findUnique({ where: { id: solo.id } })).toMatchObject({ code: 'T992', codeNormalized: 't992' });

    expect(await unirCartuchosEpson({ aplicar: true })).toEqual({ unidos: [], renombrados: [] });
  });
});
