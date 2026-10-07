import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { importarListasFabricante, type ListaFabricante } from '../services/recomendador/importarListasFabricante.js';
import { LISTAS_FABRICANTE } from '../services/recomendador/listasFabricante.js';

/**
 * #56 · Listas de impresoras del fabricante, contra MySQL de verdad.
 *
 * Marca, cartuchos e impresoras INVENTADOS (`ZZ_LST`, modelos `ZZL-…`): un test
 * que toca los datos reales acaba cambiándolos, y aquí se escriben impresoras,
 * que es lo que el kiosco enseña.
 *
 * Lo que se vigila:
 *
 *   · entra como PROPUESTA, de FABRICANTE, con la URL oficial;
 *   · no inventa cartuchos: si no existe, lo dice y sigue;
 *   · repetir no crea nada ni resucita lo rechazado;
 *   · el simulacro no escribe, y sus números son los de la pasada de verdad.
 */

const MARCA = 'ZZ_LST_MARCA';
const MODELOS_DEL_TEST = { nameNormalized: { startsWith: 'zzl' } };
const URL_OFICIAL = 'https://fabricante.example/cartucho-zz1';

const lista = (extra: Partial<ListaFabricante> = {}): ListaFabricante => ({
  marca: MARCA,
  cartuchos: ['ZZ1', 'ZZ1-PIEZA'],
  impresoras: ['ZZL-100', 'ZZL-200', 'zzl 200 '],
  fuentes: [URL_OFICIAL],
  consultado: '2026-10-01',
  ...extra,
});

let comprobado = false;
let cartuchos: number[] = [];

const limpiar = async () => {
  await prisma.cartridgePrinterModel.deleteMany({ where: { printerModel: MODELOS_DEL_TEST } });
  await prisma.printerModel.deleteMany({ where: MODELOS_DEL_TEST });
};

beforeAll(async () => {
  if (await prisma.printerBrand.count({ where: { name: MARCA } })) throw new Error(`Restos de ${MARCA}: límpialos a mano.`);
  if (await prisma.printerModel.count({ where: MODELOS_DEL_TEST })) throw new Error('Ya hay impresoras ZZL-…: límpialas a mano.');
  comprobado = true;

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const crear = async (code: string, codeNormalized: string) =>
    (await prisma.cartridge.create({ data: { brandId: marca.id, code, codeNormalized, kind: 'TINTA' } })).id;
  cartuchos = [await crear('ZZ1', 'zz1'), await crear('ZZ1-PIEZA', 'zz1pieza')];
}, 60_000);

beforeEach(limpiar);

afterAll(async () => {
  if (comprobado) {
    await limpiar();
    await prisma.cartridge.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
  }
  await prisma.$disconnect();
});

const compatibilidades = () =>
  prisma.cartridgePrinterModel.findMany({
    where: { printerModel: MODELOS_DEL_TEST },
    select: { cartridgeId: true, status: true, source: true, sourceRef: true, printerModel: { select: { name: true } } },
  });

describe('#56 · Lo que escribe', () => {
  it('cada impresora con cada código del consumible, como PROPUESTA de FABRICANTE con la URL', async () => {
    const r = await importarListasFabricante([lista()], { aplicar: true });

    // "ZZL-200" y "zzl 200 " son la misma impresora: se normaliza antes de crear.
    expect(r).toMatchObject({ listas: 1, cartuchosEnlazados: 2, modelosCreados: 2, compatibilidadesCreadas: 4, compatibilidadesExistentes: 0 });
    const filas = await compatibilidades();
    expect(filas).toHaveLength(4);
    expect(filas.every((f) => f.status === 'PROPUESTA' && f.source === 'FABRICANTE' && f.sourceRef === URL_OFICIAL)).toBe(true);
    expect(new Set(filas.map((f) => f.cartridgeId))).toEqual(new Set(cartuchos));
  });

  it('no inventa cartuchos: el que no existe se informa y el resto se carga', async () => {
    const r = await importarListasFabricante([lista({ cartuchos: ['ZZ1', 'NO-EXISTE'] })], { aplicar: true });

    expect(r.cartuchosNoEncontrados).toEqual([{ marca: MARCA, codigo: 'NO-EXISTE' }]);
    expect(await prisma.cartridge.count({ where: { brand: { name: MARCA } } })).toBe(2);
    expect(await compatibilidades()).toHaveLength(2);
  });

  it('una marca que no existe no crea nada', async () => {
    const r = await importarListasFabricante([lista({ marca: 'ZZ_LST_NADIE' })], { aplicar: true });

    expect(r.marcasNoEncontradas).toEqual(['ZZ_LST_NADIE']);
    expect(await prisma.printerModel.count({ where: MODELOS_DEL_TEST })).toBe(0);
  });
});

describe('#56 · Repetir la importación', () => {
  it('no crea nada la segunda vez', async () => {
    await importarListasFabricante([lista()], { aplicar: true });
    const r = await importarListasFabricante([lista()], { aplicar: true });

    expect(r).toMatchObject({ modelosCreados: 0, compatibilidadesCreadas: 0, compatibilidadesExistentes: 4 });
    expect(await compatibilidades()).toHaveLength(4);
  });

  it('una RECHAZADA no vuelve a pendiente, ni una VALIDADA cambia de origen', async () => {
    await importarListasFabricante([lista()], { aplicar: true });
    const [m100, m200] = await Promise.all(
      ['zzl100', 'zzl200'].map((nameNormalized) => prisma.printerModel.findFirstOrThrow({ where: { nameNormalized } })),
    );
    const clave = (printerModelId: number) => ({ cartridgeId_printerModelId: { cartridgeId: cartuchos[0], printerModelId } });
    await prisma.cartridgePrinterModel.update({ where: clave(m100.id), data: { status: 'RECHAZADA' } });
    await prisma.cartridgePrinterModel.update({ where: clave(m200.id), data: { status: 'VALIDADA', sourceRef: 'revisado a mano' } });

    await importarListasFabricante([lista()], { aplicar: true });

    expect((await prisma.cartridgePrinterModel.findUniqueOrThrow({ where: clave(m100.id) })).status).toBe('RECHAZADA');
    expect(await prisma.cartridgePrinterModel.findUniqueOrThrow({ where: clave(m200.id) })).toMatchObject({
      status: 'VALIDADA',
      sourceRef: 'revisado a mano',
    });
  });

  it('una PROPUESTA de parseo pasa a constar como de la lista; una MANUAL, no', async () => {
    // Lo que pasó con L1110↔T544: el nombre de un producto la propuso antes, y la
    // lista oficial la saltaba por repetida, así que el lote de listas no la veía.
    await importarListasFabricante([lista()], { aplicar: true });
    const [m100, m200] = await Promise.all(
      ['zzl100', 'zzl200'].map((nameNormalized) => prisma.printerModel.findFirstOrThrow({ where: { nameNormalized } })),
    );
    const clave = (printerModelId: number) => ({ cartridgeId_printerModelId: { cartridgeId: cartuchos[0], printerModelId } });
    await prisma.cartridgePrinterModel.update({ where: clave(m100.id), data: { source: 'PARSEO', sourceRef: null } });
    await prisma.cartridgePrinterModel.update({ where: clave(m200.id), data: { source: 'MANUAL', sourceRef: 'lo puso un vendedor' } });

    const r = await importarListasFabricante([lista()], { aplicar: true });

    expect(r).toMatchObject({ compatibilidadesCreadas: 0, compatibilidadesRespaldadas: 1, compatibilidadesExistentes: 3 });
    expect(await prisma.cartridgePrinterModel.findUniqueOrThrow({ where: clave(m100.id) })).toMatchObject({
      status: 'PROPUESTA',
      source: 'FABRICANTE',
      sourceRef: URL_OFICIAL,
    });
    expect(await prisma.cartridgePrinterModel.findUniqueOrThrow({ where: clave(m200.id) })).toMatchObject({
      source: 'MANUAL',
      sourceRef: 'lo puso un vendedor',
    });
  });
});

describe('#56 · El simulacro', () => {
  it('no escribe nada, y cuenta lo mismo que la pasada de verdad', async () => {
    const simulado = await importarListasFabricante([lista()], { aplicar: false });
    expect(await prisma.printerModel.count({ where: MODELOS_DEL_TEST })).toBe(0);

    const real = await importarListasFabricante([lista()], { aplicar: true });
    expect(simulado).toEqual(real);
  });
});

describe('#56 · Los datos', () => {
  it('cada lista dice de dónde sale: al menos una URL oficial, y fecha', () => {
    for (const l of LISTAS_FABRICANTE) {
      expect(l.fuentes.length, `${l.marca} ${l.cartuchos.join('/')}`).toBeGreaterThan(0);
      for (const f of l.fuentes) expect(f).toMatch(/^https:\/\//);
      expect(l.consultado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(l.impresoras.length).toBeGreaterThan(0);
    }
  });

  it('la URL de cada lista cabe en `source_ref` (255)', () => {
    for (const l of LISTAS_FABRICANTE) expect(l.fuentes[0].length).toBeLessThanOrEqual(255);
  });

  it('ninguna impresora lleva la marca delante: «Canon PIXMA…» no encontraría la «PIXMA…» que ya hubiera', () => {
    for (const l of LISTAS_FABRICANTE) {
      for (const i of l.impresoras) expect(i.toLowerCase().startsWith(l.marca.toLowerCase())).toBe(false);
    }
  });
});
