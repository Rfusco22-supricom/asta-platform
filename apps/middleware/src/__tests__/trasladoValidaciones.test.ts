import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { aplicarTraslado, claveCartucho, claveImpresora, type Traslado } from '../services/recomendador/trasladoValidaciones.js';
import revisadas from '../services/recomendador/validacionesRevisadas.json';

/**
 * #56 · Traslado de compatibilidades revisadas, contra MySQL de verdad.
 *
 * Marca, cartuchos, impresoras y plantillas INVENTADOS (`ZZ_TRS`, modelos
 * `ZZT-…`, plantillas 3.840.000.000+): el traslado escribe decisiones, y una
 * decisión equivocada en la base local cambia lo que enseña el kiosco.
 *
 * Lo que se vigila:
 *
 *   · en una base vacía crea marca, cartucho, impresora, alias y los enlaces
 *     ya decididos, con el revisor que se le da;
 *   · repetir no crea nada;
 *   · una propuesta pasa a la decisión trasladada;
 *   · una decisión DISTINTA no se pisa: se informa;
 *   · el simulacro no escribe, y sus números son los de la pasada de verdad;
 *   · el fichero versionado se lee y sus claves cuadran.
 */

const MARCA = 'ZZ_TRS_MARCA';
const DOMINIO = '@traslado.local';
const PLANTILLA = 3_840_000_000;
const DEL_TEST = { brand: { name: MARCA } };

let comprobado = false;
let revisorId = '';

const traslado = (): Traslado => ({
  exportado: '2026-10-14T00:00:00.000Z',
  cartuchos: [{ marca: MARCA, codigo: 'ZZT-9', codigoNormalizado: 'zzt9', tipo: 'TONER', color: 'NEGRO', paginas: 3000 }],
  impresoras: [{ marca: MARCA, nombre: 'ZZT Laser 100', alias: [{ alias: 'ZZT100', normalizado: 'zzt100', fuente: 'PARSEO' }] }],
  productoCartucho: [
    { plantilla: PLANTILLA, cartucho: claveCartucho(MARCA, 'zzt9'), relacion: 'COMPATIBLE', evidencia: 'ZZT-9', estado: 'VALIDADA', fuente: 'PARSEO', revisada: '2026-10-06T12:00:00.000Z' },
  ],
  cartuchoImpresora: [
    { cartucho: claveCartucho(MARCA, 'zzt9'), impresora: claveImpresora(MARCA, 'ZZT Laser 100'), referencia: 'https://fabricante.example/zzt9', estado: 'VALIDADA', fuente: 'FABRICANTE', revisada: null },
  ],
});

const limpiar = async () => {
  await prisma.productCartridge.deleteMany({ where: { cartridge: DEL_TEST } });
  await prisma.cartridgePrinterModel.deleteMany({ where: { cartridge: DEL_TEST } });
  await prisma.printerModel.deleteMany({ where: DEL_TEST });
  await prisma.cartridge.deleteMany({ where: DEL_TEST });
  await prisma.printerBrand.deleteMany({ where: { name: MARCA } });
};

beforeAll(async () => {
  if (await prisma.printerBrand.count({ where: { name: MARCA } })) throw new Error(`Restos de ${MARCA}: límpialos a mano.`);
  if (await prisma.appUser.count({ where: { email: { endsWith: DOMINIO } } })) throw new Error(`Restos de ${DOMINIO}: límpialos a mano.`);
  comprobado = true;
  const u = await prisma.appUser.create({ data: { email: `revisor${DOMINIO}`, fullName: 'ZZ Revisor', role: 'SUPERADMIN', odooPartnerId: 3_840_000_000 } });
  revisorId = u.id;
});

beforeEach(async () => {
  if (comprobado) await limpiar();
});

afterAll(async () => {
  if (comprobado) {
    await limpiar();
    await prisma.appUser.deleteMany({ where: { email: { endsWith: DOMINIO } } });
  }
  await prisma.$disconnect();
});

const enlaces = async () => ({
  pc: await prisma.productCartridge.findMany({ where: { cartridge: DEL_TEST } }),
  ci: await prisma.cartridgePrinterModel.findMany({ where: { cartridge: DEL_TEST }, include: { printerModel: { include: { aliases: true } } } }),
});

describe('#56 · Traslado de lo revisado', () => {
  it('en una base vacía crea todo lo que hace falta, ya decidido y con el revisor dado', async () => {
    const r = await aplicarTraslado(traslado(), { aplicar: true, revisorId });

    expect(r).toMatchObject({ marcasCreadas: [MARCA], cartuchosCreados: 1, impresorasCreadas: 1, aliasCreados: 1, creadas: 2, decididas: 0, iguales: 0, conflictos: [], incompletos: 0 });
    const { pc, ci } = await enlaces();
    expect(pc).toMatchObject([{ odooProductTmplId: PLANTILLA, relation: 'COMPATIBLE', status: 'VALIDADA', reviewedBy: revisorId, evidence: 'ZZT-9' }]);
    expect(pc[0]!.reviewedAt?.toISOString()).toBe('2026-10-06T12:00:00.000Z');
    expect(ci).toMatchObject([{ status: 'VALIDADA', source: 'FABRICANTE', sourceRef: 'https://fabricante.example/zzt9', reviewedBy: revisorId }]);
    expect(ci[0]!.printerModel.aliases.map((a) => a.aliasNormalized)).toEqual(['zzt100']);
  });

  it('repetir no crea nada', async () => {
    await aplicarTraslado(traslado(), { aplicar: true, revisorId });
    const r = await aplicarTraslado(traslado(), { aplicar: true, revisorId });
    expect(r).toMatchObject({ marcasCreadas: [], cartuchosCreados: 0, impresorasCreadas: 0, aliasCreados: 0, creadas: 0, iguales: 2 });
  });

  it('una propuesta pasa a la decisión revisada; una decisión distinta no se pisa', async () => {
    await aplicarTraslado(traslado(), { aplicar: true, revisorId });
    await prisma.productCartridge.updateMany({ where: { cartridge: DEL_TEST }, data: { status: 'PROPUESTA', reviewedBy: null, reviewedAt: null } });
    await prisma.cartridgePrinterModel.updateMany({ where: { cartridge: DEL_TEST }, data: { status: 'RECHAZADA' } });

    const r = await aplicarTraslado(traslado(), { aplicar: true, revisorId });

    expect(r.decididas).toBe(1);
    expect(r.conflictos).toEqual([{ que: 'cartucho→impresora', enlace: expect.stringContaining('zzt9'), aqui: 'RECHAZADA', traslado: 'VALIDADA' }]);
    const { pc, ci } = await enlaces();
    expect(pc[0]!.status).toBe('VALIDADA');
    expect(ci[0]!.status).toBe('RECHAZADA');
  });

  it('el simulacro no escribe, y cuenta lo mismo que la pasada de verdad', async () => {
    const simulado = await aplicarTraslado(traslado(), { aplicar: false, revisorId });
    expect(await prisma.printerBrand.count({ where: { name: MARCA } })).toBe(0);

    const real = await aplicarTraslado(traslado(), { aplicar: true, revisorId });
    expect(simulado).toEqual(real);
  });
});

describe('#56 · El fichero versionado', () => {
  it('se lee, y cada enlace apunta a un cartucho y una impresora del fichero', () => {
    const t = revisadas as unknown as Traslado;
    const cartuchos = new Set(t.cartuchos.map((c) => claveCartucho(c.marca, c.codigoNormalizado)));
    const impresoras = new Set(t.impresoras.map((i) => claveImpresora(i.marca, i.nombre)));

    expect(t.productoCartucho.length).toBeGreaterThan(0);
    expect(t.cartuchoImpresora.length).toBeGreaterThan(0);
    expect(t.productoCartucho.every((d) => cartuchos.has(d.cartucho))).toBe(true);
    expect(t.cartuchoImpresora.every((d) => cartuchos.has(d.cartucho) && impresoras.has(d.impresora))).toBe(true);
    // Solo decisiones: una propuesta no tiene nada que trasladar.
    expect([...t.productoCartucho, ...t.cartuchoImpresora].every((d) => d.estado === 'VALIDADA' || d.estado === 'RECHAZADA')).toBe(true);
  });
});
