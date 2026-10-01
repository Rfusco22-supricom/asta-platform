import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { importarImpresorasDeNombres } from '../services/recomendador/importarImpresorasDeNombres.js';

/**
 * #129 · Del nombre del producto a las impresoras, contra MySQL de verdad.
 *
 * Marca, cartuchos y plantillas INVENTADOS: `ZZ_IMP` y códigos que no existen en
 * el catálogo. Un test que toca los datos reales acaba cambiándolos —ya pasó con
 * `importarPropuestas`, que le cambió el tipo a un cartucho de verdad—, y aquí
 * además se escriben impresoras, que es lo que el kiosco enseña.
 *
 * Lo que se vigila:
 *
 *   · lo que se crea entra como PROPUESTA y con la evidencia;
 *   · repetir la importación no crea nada ni resucita lo rechazado;
 *   · el simulacro no escribe, y sus números son los de la pasada de verdad.
 */

const MARCA = 'ZZ_IMP_MARCA';
/**
 * Las impresoras NO son de la marca inventada: el extractor las manda a Samsung,
 * que es la marca real que dice el nombre, y eso es lo correcto. Por eso lo
 * inventado aquí son los MODELOS —"ML-99xx" no existe— y por ahí se limpian.
 */
const MODELOS_DEL_TEST = { nameNormalized: { startsWith: 'ml99' } };
/** Plantillas de Odoo que no existen. La columna es UNSIGNED INT: no caben más de 4.294.967.295. */
const T = { unico: 4_250_000_001, varios: 4_250_000_002, sinCartucho: 4_250_000_003 };
/** El nombre lleva el cartucho delante y las impresoras detrás, como los de verdad. */
const NOMBRE_UNICO = 'ZZ TONER ZZQ1 SAMSUNG ML-9916/9915/9910';
const NOMBRE_VARIOS = 'ZZ TONER ZZQ2/ZZQ3 SAMSUNG ML-9920/9921';

let comprobado = false;
let cartuchoUnico = 0;
let cartuchosVarios: number[] = [];

const productos = [
  { id: T.unico, name: NOMBRE_UNICO },
  { id: T.varios, name: NOMBRE_VARIOS },
  { id: T.sinCartucho, name: 'ZZ TONER ZZQ9 SAMSUNG ML-9930/9931' },
];

const limpiar = async () => {
  await prisma.cartridgePrinterModel.deleteMany({ where: { printerModel: MODELOS_DEL_TEST } });
  await prisma.printerModel.deleteMany({ where: MODELOS_DEL_TEST });
};

beforeAll(async () => {
  if (await prisma.printerBrand.count({ where: { name: MARCA } })) throw new Error(`Restos de ${MARCA}: límpialos a mano.`);
  if (await prisma.printerModel.count({ where: MODELOS_DEL_TEST })) throw new Error('Ya hay impresoras ML-99xx: límpialas a mano.');
  comprobado = true;

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  const crearCartucho = async (code: string) =>
    (await prisma.cartridge.create({ data: { brandId: marca.id, code, codeNormalized: code.toLowerCase(), kind: 'TONER' } })).id;

  cartuchoUnico = await crearCartucho('ZZQ1');
  cartuchosVarios = [await crearCartucho('ZZQ2'), await crearCartucho('ZZQ3')];
  await prisma.productCartridge.createMany({
    data: [
      { odooProductTmplId: T.unico, cartridgeId: cartuchoUnico, relation: 'ORIGINAL', source: 'PARSEO' },
      ...cartuchosVarios.map((cartridgeId) => ({ odooProductTmplId: T.varios, cartridgeId, relation: 'COMPATIBLE' as const, source: 'PARSEO' as const })),
    ],
  });
}, 60_000);

beforeEach(limpiar);

afterAll(async () => {
  if (comprobado) {
    await limpiar();
    await prisma.productCartridge.deleteMany({ where: { odooProductTmplId: { in: Object.values(T) } } });
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

describe('#129 · Lo que escribe', () => {
  it('crea las impresoras del nombre y las ata al cartucho del producto', async () => {
    const r = await importarImpresorasDeNombres(productos, { aplicar: true });

    expect(r).toMatchObject({ productos: 3, conImpresoras: 3, sinCartucho: 1, marcasCreadas: 0 });
    const modelos = await prisma.printerModel.findMany({ where: MODELOS_DEL_TEST, select: { name: true, brand: { select: { name: true } } } });
    // Van a la marca que dice el nombre, no a la del cartucho.
    expect([...new Set(modelos.map((m) => m.brand.name))]).toEqual(['Samsung']);
    // Las del producto sin cartucho NO se crean: una impresora que no lleva a
    // ningún producto no le sirve a nadie y ensucia la búsqueda del kiosco.
    expect(modelos.map((m) => m.name).sort()).toEqual(['ML-9910', 'ML-9915', 'ML-9916', 'ML-9920', 'ML-9921']);

    const filas = await compatibilidades();
    // 3 impresoras × 1 cartucho + 2 impresoras × 2 cartuchos.
    expect(filas).toHaveLength(7);
    expect(filas.every((f) => f.status === 'PROPUESTA' && f.source === 'PARSEO')).toBe(true);
  });

  it('la evidencia dice de qué producto y de qué trozo del nombre salió', async () => {
    await importarImpresorasDeNombres([productos[0]], { aplicar: true });
    const [fila] = await compatibilidades();
    // El fragmento empieza en la primera impresora, no en la marca: lo que va
    // delante es el cartucho, y meterlo en la evidencia solo despista.
    expect(fila.sourceRef).toBe(`product.template #${T.unico}: ML-9916/9915/9910`);
  });

  it('con varios cartuchos avisa en la propia nota: el nombre no dice cuál va con cuál', async () => {
    const r = await importarImpresorasDeNombres([productos[1]], { aplicar: true });
    expect(r.conVariosCartuchos).toBe(1);
    const filas = await compatibilidades();
    expect(filas).toHaveLength(4);
    expect(filas[0].sourceRef).toContain('el producto lista 2 cartuchos: confirmar cuál');
  });
});

describe('#129 · Repetir la importación', () => {
  it('no crea nada la segunda vez', async () => {
    await importarImpresorasDeNombres(productos, { aplicar: true });
    const antes = await compatibilidades();

    const r = await importarImpresorasDeNombres(productos, { aplicar: true });
    expect(r).toMatchObject({ modelosCreados: 0, compatibilidadesCreadas: 0, compatibilidadesExistentes: 7 });
    expect(await compatibilidades()).toHaveLength(antes.length);
  });

  it('una compatibilidad RECHAZADA no vuelve a pendiente', async () => {
    await importarImpresorasDeNombres([productos[0]], { aplicar: true });
    const modelo = await prisma.printerModel.findFirstOrThrow({ where: { nameNormalized: 'ml9916' } });
    await prisma.cartridgePrinterModel.update({
      where: { cartridgeId_printerModelId: { cartridgeId: cartuchoUnico, printerModelId: modelo.id } },
      data: { status: 'RECHAZADA' },
    });

    await importarImpresorasDeNombres([productos[0]], { aplicar: true });
    const fila = await prisma.cartridgePrinterModel.findUniqueOrThrow({
      where: { cartridgeId_printerModelId: { cartridgeId: cartuchoUnico, printerModelId: modelo.id } },
    });
    expect(fila.status).toBe('RECHAZADA');
  });

  it('una VALIDADA tampoco se toca', async () => {
    await importarImpresorasDeNombres([productos[0]], { aplicar: true });
    const modelo = await prisma.printerModel.findFirstOrThrow({ where: { nameNormalized: 'ml9915' } });
    await prisma.cartridgePrinterModel.update({
      where: { cartridgeId_printerModelId: { cartridgeId: cartuchoUnico, printerModelId: modelo.id } },
      data: { status: 'VALIDADA', sourceRef: 'revisado a mano' },
    });

    await importarImpresorasDeNombres([productos[0]], { aplicar: true });
    const fila = await prisma.cartridgePrinterModel.findUniqueOrThrow({
      where: { cartridgeId_printerModelId: { cartridgeId: cartuchoUnico, printerModelId: modelo.id } },
    });
    expect(fila).toMatchObject({ status: 'VALIDADA', sourceRef: 'revisado a mano' });
  });
});

describe('#129 · El simulacro', () => {
  it('no escribe nada, y cuenta lo mismo que la pasada de verdad', async () => {
    const simulado = await importarImpresorasDeNombres(productos, { aplicar: false });
    expect(await prisma.printerModel.count({ where: MODELOS_DEL_TEST })).toBe(0);

    const real = await importarImpresorasDeNombres(productos, { aplicar: true });
    expect(simulado).toEqual(real);
    expect(await prisma.printerModel.count({ where: MODELOS_DEL_TEST })).toBe(5);
  });
});
