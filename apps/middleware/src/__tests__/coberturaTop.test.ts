import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #56 · Cobertura del top de ventas: la cifra que decide si el kiosco sale.
 *
 * Las ventas van SIMULADAS —vienen de Odoo y no se pueden fijar desde aquí— para
 * poder construir un top 20 exacto y comprobar los tres tramos del umbral de #7.
 * MySQL es el real, con marca y cartuchos `ZZ_COB` que no existen.
 *
 * Lo que se vigila:
 *
 *   · cubierto = la cadena ENTERA validada (impresora → cartucho → producto).
 *     Media cadena no sirve: el kiosco no devuelve nada.
 *   · el tramo sale del porcentaje, no de la pantalla.
 */

const odoo = vi.hoisted(() => ({ ventas: new Map<number, number>() }));

vi.mock('../services/recomendador/revision.service.js', async (original) => {
  const real = await original<typeof import('../services/recomendador/revision.service.js')>();
  return {
    ...real,
    ventasPorPlantilla: vi.fn(async () => odoo.ventas),
    // Sin nombres de Odoo: el informe tiene que salir igual.
    plantillas: vi.fn(async () => new Map()),
  };
});

const { prisma } = await import('../config/prisma.js');
const { coberturaDelTop } = await import('../services/recomendador/cobertura.service.js');

const MARCA = 'ZZ_COB_MARCA';
/** Plantillas de Odoo que no existen: aquí solo son números. */
const T = Array.from({ length: 21 }, (_, i) => 4_200_000_000 + i);
let comprobado = false;
const cartuchos: number[] = [];
let impresoraActiva = 0;
let impresoraRetirada = 0;

beforeAll(async () => {
  if (await prisma.printerBrand.count({ where: { name: MARCA } })) throw new Error(`Restos de ${MARCA}: límpialos a mano.`);
  comprobado = true;

  const marca = await prisma.printerBrand.create({ data: { name: MARCA } });
  for (let i = 0; i < 4; i++) {
    const c = await prisma.cartridge.create({ data: { brandId: marca.id, code: `ZZCOB${i}`, codeNormalized: `zzcob${i}`, kind: 'TONER' } });
    cartuchos.push(c.id);
  }
  impresoraActiva = (await prisma.printerModel.create({ data: { brandId: marca.id, name: 'ZZ-Cob 100', nameNormalized: 'zzcob100' } })).id;
  impresoraRetirada = (await prisma.printerModel.create({ data: { brandId: marca.id, name: 'ZZ-Cob 200', nameNormalized: 'zzcob200', isActive: false } })).id;

  // c0: cadena completa. c1: sin impresora. c2: impresora RETIRADA. c3: la
  // compatibilidad con la impresora está sin validar.
  await prisma.cartridgePrinterModel.createMany({
    data: [
      { cartridgeId: cartuchos[0], printerModelId: impresoraActiva, source: 'MANUAL', status: 'VALIDADA' },
      { cartridgeId: cartuchos[2], printerModelId: impresoraRetirada, source: 'MANUAL', status: 'VALIDADA' },
      { cartridgeId: cartuchos[3], printerModelId: impresoraActiva, source: 'MANUAL', status: 'PROPUESTA' },
    ],
  });
}, 60_000);

beforeEach(async () => {
  odoo.ventas.clear();
  await prisma.productCartridge.deleteMany({ where: { cartridgeId: { in: cartuchos } } });
});

afterAll(async () => {
  if (comprobado) {
    await prisma.productCartridge.deleteMany({ where: { cartridgeId: { in: cartuchos } } });
    await prisma.cartridge.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerModel.deleteMany({ where: { brand: { name: MARCA } } });
    await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
  }
  await prisma.$disconnect();
});

/**
 * `T[i]` vende `(cuantas - i) * 1000`: T[0] es el que más vende.
 *
 * Se insertan DESORDENADAS a propósito. Con el mapa ya ordenado, quitar el
 * `sort` del servicio no rompía ningún test: el orden venía de casualidad.
 */
function conVentas(cuantas: number) {
  const orden = [...Array(cuantas).keys()].sort((x, y) => ((x * 7) % cuantas) - ((y * 7) % cuantas));
  for (const i of orden) odoo.ventas.set(T[i], (cuantas - i) * 1000);
}

const validar = (templateId: number, cartridgeId: number) =>
  prisma.productCartridge.create({ data: { odooProductTmplId: templateId, cartridgeId, relation: 'ORIGINAL', source: 'MANUAL', status: 'VALIDADA' } });

describe('#56 · Qué cuenta como cubierto', () => {
  it('la cadena entera; media cadena NO', async () => {
    conVentas(4);
    await validar(T[0], cartuchos[0]); // completo
    await validar(T[1], cartuchos[1]); // cartucho validado, ninguna impresora
    await validar(T[2], cartuchos[2]); // su única impresora está retirada
    // T[3] se queda sin ningún cartucho validado.

    const r = await coberturaDelTop();
    expect(r.productos.map((p) => p.estado)).toEqual(['completo', 'sin_impresora', 'sin_impresora', 'sin_cartucho']);
    expect(r.totales).toMatchObject({ top: 4, completos: 1, porcentaje: 25, tramo: 'pospuesta' });
  });

  it('una PROPUESTA de producto no cuenta, aunque su cartucho tenga impresora', async () => {
    conVentas(1);
    await prisma.productCartridge.create({
      data: { odooProductTmplId: T[0], cartridgeId: cartuchos[0], relation: 'ORIGINAL', source: 'MANUAL', status: 'PROPUESTA' },
    });
    expect((await coberturaDelTop()).productos[0].estado).toBe('sin_cartucho');
  });

  it('una compatibilidad de impresora sin validar tampoco, y dice por qué cartucho seguir', async () => {
    conVentas(1);
    await validar(T[0], cartuchos[3]);
    const p = (await coberturaDelTop()).productos[0];
    expect(p.estado).toBe('sin_impresora');
    // El código es lo que se busca en la pestaña de impresoras: la referencia
    // del producto allí no encuentra nada.
    expect(p.cartuchos).toEqual(['ZZCOB3']);
  });
});

describe('#56 · El top y el umbral de #7', () => {
  it('son los 20 MÁS VENDIDOS, de mayor a menor, aunque haya más productos', async () => {
    conVentas(21);
    const r = await coberturaDelTop();
    expect(r.productos).toHaveLength(20);
    expect(r.productos[0].templateId).toBe(T[0]);
    // El 21.º, el que menos vende, se queda fuera.
    expect(r.productos.map((p) => p.templateId)).not.toContain(T[20]);
    expect(r.productos.map((p) => p.ventas12m)).toEqual([...r.productos.map((p) => p.ventas12m)].sort((a, b) => b - a));
  });

  it('> 85 % procede; 60-85 % con respaldo; por debajo, pospuesta', async () => {
    const tramoCon = async (completos: number) => {
      await prisma.productCartridge.deleteMany({ where: { cartridgeId: { in: cartuchos } } });
      odoo.ventas.clear();
      conVentas(20);
      for (let i = 0; i < completos; i++) await validar(T[i], cartuchos[0]);
      const r = await coberturaDelTop();
      return { porcentaje: r.totales.porcentaje, tramo: r.totales.tramo };
    };

    expect(await tramoCon(18)).toEqual({ porcentaje: 90, tramo: 'procede' });
    expect(await tramoCon(17)).toEqual({ porcentaje: 85, tramo: 'con_respaldo' });
    expect(await tramoCon(12)).toEqual({ porcentaje: 60, tramo: 'con_respaldo' });
    expect(await tramoCon(11)).toEqual({ porcentaje: 55, tramo: 'pospuesta' });
  });

  it('también dice cuánto IMPORTE cubre, que es lo que se pierde mientras tanto', async () => {
    conVentas(2); // 2000 y 1000
    await validar(T[1], cartuchos[0]); // el de 1000
    const r = await coberturaDelTop();
    expect(r.totales).toMatchObject({ importeTop: 3000, importeCubierto: 1000 });
  });

  it('sin ventas en Odoo no se inventa un porcentaje', async () => {
    const r = await coberturaDelTop();
    expect(r.totales).toMatchObject({ top: 0, completos: 0, porcentaje: 0, tramo: 'pospuesta' });
    expect(r.productos).toEqual([]);
  });
});
