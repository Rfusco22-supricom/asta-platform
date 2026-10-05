import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../config/prisma.js';

/**
 * #56 · Los casos claros del tramo producto → cartucho, en lote.
 *
 * Lo que se vigila: que un caso claro sea de verdad claro (ASTA, a la venta, no
 * una pieza suelta, COMPATIBLE y con el código exacto en el nombre), y que por
 * esta ruta no se pueda validar nada más aunque alguien lo mande.
 *
 * Los nombres de Odoo se simulan: los productos son inventados (ids 3.9e9…).
 */

const NOMBRES = new Map<number, { nombre: string; sku: string | null; activo: boolean }>([
  [3_900_000_001, { nombre: 'ASTA TONER ZZ958A CON CHIP', sku: 'A-ZZ958A', activo: true }],
  [3_900_000_002, { nombre: 'ASTA TONER ZZ-145 XL NEGRO', sku: 'A-ZZ145XL', activo: true }],
  // El código no está entero: ZZ958 no es ZZ958A.
  [3_900_000_003, { nombre: 'ASTA TONER ZZ958 NEGRO', sku: 'A-ZZ958', activo: true }],
  // Polvo: no sustituye al cartucho.
  [3_900_000_004, { nombre: 'ASTA POLVO TONER ZZ958A', sku: 'A-PZZ958A', activo: true }],
  // No es ASTA.
  [3_900_000_005, { nombre: 'HP TONER ZZ958A ORIGINAL', sku: 'ZZ958A', activo: true }],
  // Retirado de la venta.
  [3_900_000_006, { nombre: 'ASTA TONER ZZ958A', sku: 'A-ZZ958A-OLD', activo: false }],
]);

vi.mock('../services/recomendador/revision.service.js', async (original) => {
  const real = await original<typeof import('../services/recomendador/revision.service.js')>();
  return {
    ...real,
    plantillasSiOdooResponde: async (ids: number[]) => new Map(ids.filter((id) => NOMBRES.has(id)).map((id) => [id, NOMBRES.get(id)!])),
  };
});

const { nombreTraeCodigo, paresAstaClaros, validarLoteAsta } = await import('../services/recomendador/loteAsta.service.js');

describe('nombreTraeCodigo', () => {
  it.each([
    ['ASTA TONER CF258A CON CHIP', 'CF258A'],
    ['CANON CARTUCHO DE TINTA PG-145 XL -NEGRO', 'PG-145XL'],
    ['ASTA TONER CB435A/CB436A/CE278A/285', 'CE278A'],
    ['HP CARTUCHO 667 BLACK', '667'],
  ])('«%s» trae %s', (nombre, codigo) => expect(nombreTraeCodigo(nombre, codigo)).toBe(true));

  it.each([
    // «285» no es CE285A.
    ['ASTA TONER CB435A/CB436A/CE278A/285', 'CE285A'],
    // Letras de más: CE285A no es CE285.
    ['ASTA TONER CE285A', 'CE285'],
    ['ASTA TONER XCE285A', 'CE285A'],
    // Sin cifras no se arriesga.
    ['ASTA TONER NEGRO', 'NEGRO'],
  ])('«%s» NO trae %s', (nombre, codigo) => expect(nombreTraeCodigo(nombre, codigo)).toBe(false));
});

describe('Lote ASTA, contra MySQL', () => {
  const MARCA = 'ZZ_LOTEASTA';
  let marcaId = 0;
  let revisor = '';
  const cartucho: Record<string, number> = {};

  beforeAll(async () => {
    if (await prisma.printerBrand.count({ where: { name: MARCA } })) throw new Error(`Restos de ${MARCA}: límpialos a mano.`);
    marcaId = (await prisma.printerBrand.create({ data: { name: MARCA } })).id;
    for (const c of ['ZZ958A', 'ZZ145XL']) {
      cartucho[c] = (await prisma.cartridge.create({ data: { brandId: marcaId, code: c, codeNormalized: c.toLowerCase(), kind: 'TONER' } })).id;
    }
    const u = await prisma.appUser.create({
      data: { email: 'test.loteasta@loteasta.local', fullName: 'Lote ASTA', role: 'SUPERADMIN', odooPartnerId: 3_830_000_000, isActive: true },
    });
    revisor = u.id;
    const fila = (tmpl: number, codigo: string, relation: 'COMPATIBLE' | 'ORIGINAL' = 'COMPATIBLE') =>
      prisma.productCartridge.create({ data: { odooProductTmplId: tmpl, cartridgeId: cartucho[codigo]!, relation, source: 'PARSEO', status: 'PROPUESTA' } });
    await fila(3_900_000_001, 'ZZ958A');
    await fila(3_900_000_002, 'ZZ145XL');
    await fila(3_900_000_003, 'ZZ958A');
    await fila(3_900_000_004, 'ZZ958A');
    await fila(3_900_000_005, 'ZZ958A', 'ORIGINAL');
    await fila(3_900_000_006, 'ZZ958A');
  });

  afterAll(async () => {
    if (marcaId) {
      await prisma.cartridge.deleteMany({ where: { brandId: marcaId } });
      await prisma.printerBrand.delete({ where: { id: marcaId } });
    }
    if (revisor) await prisma.appUser.delete({ where: { id: revisor } });
    await prisma.$disconnect();
  });

  const nuestros = async () => ((await paresAstaClaros()) ?? []).filter((p) => p.marca === MARCA);

  it('solo salen los casos claros', async () => {
    expect((await nuestros()).map((p) => [p.templateId, p.codigo])).toEqual([
      [3_900_000_002, 'ZZ145XL'],
      [3_900_000_001, 'ZZ958A'],
    ]);
  });

  it('un par que no es caso claro no se valida, ni los demás con él', async () => {
    await expect(
      validarLoteAsta(
        [
          { templateId: 3_900_000_001, cartridgeId: cartucho.ZZ958A! },
          { templateId: 3_900_000_004, cartridgeId: cartucho.ZZ958A! },
        ],
        revisor,
      ),
    ).rejects.toThrow(/caso claro/);
    expect(await nuestros()).toHaveLength(2);
  });

  it('valida los claros, y dejan de salir', async () => {
    const pares = (await nuestros()).map(({ templateId, cartridgeId }) => ({ templateId, cartridgeId }));
    expect(await validarLoteAsta(pares, revisor)).toEqual({ validadas: 2 });
    expect(await nuestros()).toEqual([]);
    const fila = await prisma.productCartridge.findFirstOrThrow({ where: { odooProductTmplId: 3_900_000_001, cartridgeId: cartucho.ZZ958A! } });
    expect([fila.status, fila.reviewedBy]).toEqual(['VALIDADA', revisor]);
    // Lo que no era claro sigue pendiente.
    expect(await prisma.productCartridge.count({ where: { cartridgeId: cartucho.ZZ958A!, status: 'PROPUESTA' } })).toBe(4);
  });
});
