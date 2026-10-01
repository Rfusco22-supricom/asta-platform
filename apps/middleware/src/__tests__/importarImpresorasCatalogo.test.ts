import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { importarImpresorasDeCatalogo, type ProductoImpresora } from '../services/recomendador/importarImpresorasDeCatalogo.js';

/**
 * #40 · Las impresoras que vende Supricom, a `printer_models`, contra MySQL de verdad.
 *
 * La marca es real —HP—, porque el extractor solo lee marcas que conoce; lo
 * inventado son los MODELOS («ZZ99…» no existe) y por ahí se limpia. Si este
 * test creó la marca, también la borra.
 *
 * Lo que se vigila:
 *
 *   · una impresora que ya estaba con otro nombre se marca, no se duplica;
 *   · dos productos de la misma impresora («OPEN BOX») crean una sola;
 *   · una desactivada se marca pero NO se reactiva;
 *   · lo que no es impresora no entra;
 *   · el simulacro no escribe, y sus números son los de la pasada de verdad;
 *   · repetir no cambia nada.
 */

const DEL_TEST = { nameNormalized: { contains: 'zz99' } };
const T = 4_260_000_000;

const productos: ProductoImpresora[] = [
  // Ya estaba, como la dejó el importador de tóners: «MFP ZZ9928FDW».
  { id: T + 1, name: 'HP IMPRESORA LASERJET PRO MFP ZZ9928FDW', default_code: 'ZZ1' },
  // La misma impresora, dos veces.
  { id: T + 2, name: 'HP IMPRESORA LASERJET ZZ9901W', default_code: 'ZZ2' },
  { id: T + 3, name: 'HP ZZ9901W - IMPRESORA LASER (OPEN BOX)', default_code: 'ZZ2-OB' },
  // Desactivada a mano por alguien.
  { id: T + 4, name: 'HP IMPRESORA ZZ9903DN', default_code: 'ZZ4' },
  // No es una impresora.
  { id: T + 5, name: 'HP ZZ9904 - ESCANER DE DOCUMENTOS', default_code: 'ZZ5' },
];

let comprobado = false;
let marcaCreadaPorElTest = false;
let existenteId = 0;
let desactivadaId = 0;

beforeAll(async () => {
  if (await prisma.printerModel.count({ where: DEL_TEST })) throw new Error('Ya hay impresoras ZZ99…: límpialas a mano.');
  comprobado = true;
  let hp = await prisma.printerBrand.findFirst({ where: { name: 'HP' } });
  if (!hp) {
    hp = await prisma.printerBrand.create({ data: { name: 'HP' } });
    marcaCreadaPorElTest = true;
  }
  existenteId = (await prisma.printerModel.create({ data: { brandId: hp.id, name: 'MFP ZZ9928FDW', nameNormalized: 'mfpzz9928fdw' } })).id;
  desactivadaId = (await prisma.printerModel.create({ data: { brandId: hp.id, name: 'ZZ9903DN', nameNormalized: 'zz9903dn', isActive: false } })).id;
});

afterAll(async () => {
  if (comprobado) {
    await prisma.printerModel.deleteMany({ where: DEL_TEST });
    if (marcaCreadaPorElTest) await prisma.printerBrand.deleteMany({ where: { name: 'HP', printerModels: { none: {} }, cartridges: { none: {} } } });
  }
  await prisma.$disconnect();
});

describe('importarImpresorasDeCatalogo', () => {
  it('el simulacro no escribe nada', async () => {
    const r = await importarImpresorasDeCatalogo(productos, { aplicar: false });
    expect(r).toMatchObject({ productos: 5, impresoras: 3, creadas: 1, marcadas: 2, yaMarcadas: 0, desactivadas: 1 });
    expect(r.descartados.no_es_impresora).toBe(1);
    expect(await prisma.printerModel.count({ where: DEL_TEST })).toBe(2);
    expect(await prisma.printerModel.count({ where: { ...DEL_TEST, inOdooCatalog: true } })).toBe(0);
  });

  it('aplicando: marca la que ya estaba, crea una sola por modelo y no reactiva', async () => {
    const r = await importarImpresorasDeCatalogo(productos, { aplicar: true });
    expect(r).toMatchObject({ impresoras: 3, creadas: 1, marcadas: 2, yaMarcadas: 0 });

    const filas = await prisma.printerModel.findMany({
      where: DEL_TEST,
      select: { id: true, name: true, isActive: true, inOdooCatalog: true },
      orderBy: { id: 'asc' },
    });
    expect(filas).toEqual([
      { id: existenteId, name: 'MFP ZZ9928FDW', isActive: true, inOdooCatalog: true },
      { id: desactivadaId, name: 'ZZ9903DN', isActive: false, inOdooCatalog: true },
      { id: expect.any(Number), name: 'LaserJet ZZ9901W', isActive: true, inOdooCatalog: true },
    ]);
  });

  it('repetir no cambia nada', async () => {
    const r = await importarImpresorasDeCatalogo(productos, { aplicar: true });
    expect(r).toMatchObject({ creadas: 0, marcadas: 0, yaMarcadas: 3 });
    expect(await prisma.printerModel.count({ where: DEL_TEST })).toBe(3);
  });
});
