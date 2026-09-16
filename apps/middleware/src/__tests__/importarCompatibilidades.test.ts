import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { importarCompatibilidades, type FilaFuente } from '../services/recomendador/importarCompatibilidades.js';

/**
 * #56 · Importación de `compatibilidad_productos` contra MySQL.
 *
 * Datos inventados: la marca `ZZ_IMP` y códigos `ZZIMP*` no existen. El caso de
 * Canon necesita la marca Canon de verdad —la regla del prefijo «CRG» es suya—,
 * así que ahí se usan códigos `ZZ9*` y modelos `ZZ-CANON*` que tampoco existen, y
 * se borra solo eso.
 */

const MARCA = 'ZZ_IMP';
const CODIGOS = ['zzimp1', 'zzimp2', 'zzimp3', 'zz901', 'crgzz902'];

let comprobado = false;
let canonCreada = false;

const F = (id: number, code: string, modelo: string, rendimientoPag: number | null = null, marca = MARCA): FilaFuente => ({
  id: 900_000 + id,
  code,
  marca,
  modelo,
  rendimientoPag,
});

const FILAS: FilaFuente[] = [
  F(1, 'ZZIMP1', 'ZZ_IMP ZZJet 9101/9102 (negro)', 1500),
  F(2, 'ZZIMP2', 'ZZJet 9102, ZZJet 9103', 2000),
  F(3, 'ZZIMP3', 'solo texto sin modelos'),
];

async function relaciones(codigo: string) {
  return prisma.cartridgePrinterModel.findMany({
    where: { cartridge: { codeNormalized: codigo } },
    include: { printerModel: true },
    orderBy: { printerModel: { name: 'asc' } },
  });
}

beforeAll(async () => {
  const restos =
    (await prisma.printerBrand.count({ where: { name: MARCA } })) +
    (await prisma.cartridge.count({ where: { codeNormalized: { in: CODIGOS } } })) +
    (await prisma.printerModel.count({ where: { nameNormalized: { startsWith: 'zzcanon' } } }));
  if (restos) throw new Error('Hay restos de un test anterior (ZZ_IMP / ZZ9* / ZZ-CANON*). Límpialos a mano.');
  comprobado = true;
  canonCreada = !(await prisma.printerBrand.findFirst({ where: { name: 'canon' } }));
});

afterAll(async () => {
  // Vitest ejecuta afterAll aunque beforeAll falle: sin la comprobación, nada de
  // lo que hay es de este test.
  if (comprobado) {
    await prisma.cartridge.deleteMany({ where: { codeNormalized: { in: CODIGOS } } });
    await prisma.printerModel.deleteMany({ where: { OR: [{ brand: { name: MARCA } }, { nameNormalized: { startsWith: 'zzcanon' } }] } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
    if (canonCreada) await prisma.printerBrand.deleteMany({ where: { name: 'Canon', cartridges: { none: {} }, printerModels: { none: {} } } });
  }
  await prisma.$disconnect();
});

describe('#56 · Simulacro', () => {
  it('cuenta lo que haría y no escribe nada', async () => {
    const r = await importarCompatibilidades(FILAS, { aplicar: false });
    expect(r).toMatchObject({ marcasCreadas: 1, cartuchosCreados: 3, modelosCreados: 3, compatibilidadesCreadas: 4 });
    expect(await prisma.printerBrand.count({ where: { name: MARCA } })).toBe(0);
    expect(await prisma.cartridge.count({ where: { codeNormalized: { in: CODIGOS } } })).toBe(0);
  });
});

describe('#56 · Primera importación', () => {
  it('crea marca, cartuchos, modelos y relaciones como PROPUESTA, con la fila de origen', async () => {
    const r = await importarCompatibilidades(FILAS, { aplicar: true });
    expect(r).toMatchObject({ filas: 3, marcasCreadas: 1, cartuchosCreados: 3, modelosCreados: 3, compatibilidadesCreadas: 4, compatibilidadesExistentes: 0 });

    const uno = await relaciones('zzimp1');
    expect(uno.map((x) => [x.printerModel.name, x.status, x.source, x.createdBy])).toEqual([
      ['ZZJet 9101', 'PROPUESTA', 'MANUAL', null],
      ['ZZJet 9102', 'PROPUESTA', 'MANUAL', null],
    ]);
    expect(uno[0].sourceRef).toBe('compatibilidad_productos #900001: ZZ_IMP ZZJet 9101/9102 (negro)');
  });

  it('el mismo modelo en dos filas es UNA impresora con dos cartuchos', async () => {
    const modelo = await prisma.printerModel.findFirstOrThrow({ where: { nameNormalized: 'zzjet9102' }, include: { cartridges: true } });
    expect(modelo.cartridges).toHaveLength(2);
  });

  it('guarda rendimiento y color del cartucho nuevo', async () => {
    const c = await prisma.cartridge.findFirstOrThrow({ where: { codeNormalized: 'zzimp1' } });
    expect([c.yieldPages, c.color, c.kind]).toEqual([1500, 'negro', 'TONER']);
  });

  it('informa de las filas sin modelos y de los códigos sin cartucho previo', async () => {
    const r = await importarCompatibilidades(FILAS, { aplicar: false });
    expect(r.sinModelos.map((s) => s.code)).toEqual(['ZZIMP3']);
  });
});

describe('#56 · Volver a importar no toca lo revisado', () => {
  it('no crea nada nuevo', async () => {
    const r = await importarCompatibilidades(FILAS, { aplicar: true });
    expect(r).toMatchObject({ marcasCreadas: 0, cartuchosCreados: 0, modelosCreados: 0, compatibilidadesCreadas: 0, compatibilidadesExistentes: 4, cartuchosQueCruzan: 3 });
  });

  it('una RECHAZADA sigue rechazada, y el tipo corregido de un cartucho se respeta', async () => {
    const [primera] = await relaciones('zzimp1');
    await prisma.cartridgePrinterModel.update({
      where: { cartridgeId_printerModelId: { cartridgeId: primera.cartridgeId, printerModelId: primera.printerModelId } },
      data: { status: 'RECHAZADA', reviewedAt: new Date() },
    });
    await prisma.cartridge.updateMany({ where: { codeNormalized: 'zzimp1' }, data: { kind: 'DRUM', yieldPages: 999 } });

    await importarCompatibilidades(FILAS, { aplicar: true });

    const [despues] = await relaciones('zzimp1');
    expect(despues.status).toBe('RECHAZADA');
    const c = await prisma.cartridge.findFirstOrThrow({ where: { codeNormalized: 'zzimp1' } });
    // El rendimiento existente no se pisa con el de la tabla (1500): solo se rellena si está vacío.
    expect([c.kind, c.yieldPages]).toEqual(['DRUM', 999]);
  });

  it('rellena el rendimiento de un cartucho existente que no lo tenía', async () => {
    await prisma.cartridge.updateMany({ where: { codeNormalized: 'zzimp2' }, data: { yieldPages: null } });
    const r = await importarCompatibilidades(FILAS, { aplicar: true });
    expect(r.rendimientosRellenados).toBe(1);
    expect((await prisma.cartridge.findFirstOrThrow({ where: { codeNormalized: 'zzimp2' } })).yieldPages).toBe(2000);
  });
});

describe('#56 · Canon: «CRG» en la tabla, sin prefijo en Odoo', () => {
  it('CRGZZ901 cruza con el cartucho ZZ901 que ya existía, en vez de duplicarlo', async () => {
    const canon = (await prisma.printerBrand.findFirst({ where: { name: 'canon' } })) ?? (await prisma.printerBrand.create({ data: { name: 'Canon' } }));
    await prisma.cartridge.create({ data: { brandId: canon.id, code: 'ZZ901', codeNormalized: 'zz901', kind: 'TONER' } });

    const r = await importarCompatibilidades([F(10, 'CRGZZ901', 'Canon ZZ-CANON 9901', null, 'CANON'), F(11, 'CRGZZ902', 'ZZ-CANON 9902', null, 'CANON')], { aplicar: true });

    expect(r.cartuchosQueCruzan).toBe(1);
    expect(r.codigosSinCruce.map((c) => c.code)).toEqual(['CRGZZ902']);
    expect(await prisma.cartridge.count({ where: { brandId: canon.id, codeNormalized: { in: ['zz901', 'crgzz901'] } } })).toBe(1);
    expect((await relaciones('zz901')).map((x) => x.printerModel.name)).toEqual(['ZZ-CANON 9901']);
  });
});
