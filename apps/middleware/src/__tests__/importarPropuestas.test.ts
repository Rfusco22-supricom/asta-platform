import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { importarPropuestas, relacionConCartucho, tipoDeCartucho, type ProductoOdoo } from '../services/recomendador/importarPropuestas.js';
import { extraerCartuchos } from '../services/recomendador/extraerCartuchos.js';

/**
 * #56 · Importación de propuestas producto → cartucho, contra MySQL.
 *
 * La regla que se vigila por encima de todo: **volver a importar no toca nada de
 * lo que ya existe**. El importador se ejecutará cada vez que entren productos
 * nuevos, y para entonces habrá filas validadas y rechazadas por una persona.
 *
 * ── Aislado de una carga real en la misma base ──────────────────────────────
 *
 * La primera versión usaba códigos reales (PG-145XL, CE278A…). Con la carga real
 * hecha en la base de desarrollo, el test FALLABA —los cartuchos ya existían— y,
 * peor, el caso del tipo de cartucho cambió el `kind` del PG-145XL real. Un test
 * no puede modificar datos que no creó.
 *
 * Así que los productos tienen nombres con la forma de los reales pero códigos
 * que no existen (PG-999XL, 998A…), ids de producto ficticios, y el test
 * comprueba al empezar que nadie los ha cargado. Al terminar borra SOLO eso.
 */

const P = (id: number, name: string, default_code: string | false): ProductoOdoo => ({ id: 999_000_000 + id, name, default_code });

const PRODUCTOS: ProductoOdoo[] = [
  P(1, 'CANON  CARTUCHO DE TINTA PG-999 XL -NEGRO', '9999B001AA'),
  P(2, 'HP TONER 998A NEGRO ORIGINAL', 'W9998A'),
  P(3, 'ASTA TONER CB997A/CB998A/CE998A/285', 'A-CB997A-CE998A'),
  P(4, 'ASTA BROTHER DR998 - UNIDAD DE TAMBOR', 'A-DR-998'),
  P(5, 'CANON SX740 HS - CAMARA FOTOGRAFICA PROFESIONAL', '2955C001AA'),
];
const NUEVO = P(6, 'HP CARTUCHO 997 BLACK ', '9ZZ97AL');
const IDS = [...PRODUCTOS, NUEVO].map((p) => p.id);
/** Todos los cartuchos que puede crear este fichero, por código normalizado. */
const CODIGOS_DE_PRUEBA = ['pg999xl', '998a', 'w9998a', 'cb997a', 'cb998a', 'ce998a', 'dr998', '997'];

let marcasPrevias: string[] = [];
/**
 * Vitest ejecuta `afterAll` aunque `beforeAll` falle. Sin esta marca, justo
 * cuando la comprobación detecta cartuchos reales con estos códigos, la limpieza
 * los borraría —y por el ON DELETE CASCADE, sus compatibilidades validadas— y,
 * con `marcasPrevias` aún vacío, también todas las marcas sin cartuchos.
 */
let baseComprobada = false;

async function propuestasDePrueba() {
  return prisma.productCartridge.findMany({
    where: { odooProductTmplId: { in: IDS } },
    include: { cartridge: { include: { brand: true } } },
    orderBy: [{ odooProductTmplId: 'asc' }, { cartridgeId: 'asc' }],
  });
}

beforeAll(async () => {
  const yaEstan = await prisma.cartridge.count({ where: { codeNormalized: { in: CODIGOS_DE_PRUEBA } } });
  const filas = await prisma.productCartridge.count({ where: { odooProductTmplId: { in: IDS } } });
  if (yaEstan > 0 || filas > 0) {
    throw new Error('Los cartuchos o productos de prueba ya existen en la base: el test no puede distinguir lo suyo. Límpialos a mano.');
  }
  marcasPrevias = (await prisma.printerBrand.findMany({ select: { name: true } })).map((m) => m.name);
  baseComprobada = true;
});

afterAll(async () => {
  if (!baseComprobada) {
    // La base no estaba limpia o no se pudo leer: nada de lo que hay es de este test.
    await prisma.$disconnect();
    return;
  }
  await prisma.productCartridge.deleteMany({ where: { odooProductTmplId: { in: IDS } } });
  await prisma.cartridge.deleteMany({ where: { codeNormalized: { in: CODIGOS_DE_PRUEBA } } });
  // Una marca solo se borra si la creó este test Y no le quedan cartuchos.
  await prisma.printerBrand.deleteMany({ where: { name: { notIn: marcasPrevias.length ? marcasPrevias : [''] }, cartridges: { none: {} } } });
  await prisma.$disconnect();
});

describe('#56 · Primera importación', () => {
  it('crea una PROPUESTA por candidato, con evidencia, relación y tipo', async () => {
    const r = await importarPropuestas(PRODUCTOS);
    expect(r.productos).toBe(5);
    expect(r.sinCandidato).toBe(1); // la cámara
    expect(r.cartuchosCreados).toBe(7);

    const filas = await propuestasDePrueba();
    const vistas = filas.map((f) => `${f.odooProductTmplId - 999_000_000} ${f.cartridge.brand.name}:${f.cartridge.code} ${f.relation} ${f.cartridge.kind} ${f.status} ${f.source}`);
    expect(vistas.sort()).toEqual(
      [
        '1 Canon:PG-999XL ORIGINAL TINTA PROPUESTA PARSEO',
        '2 HP:998A ORIGINAL TONER PROPUESTA PARSEO',
        '2 HP:W9998A ORIGINAL TONER PROPUESTA PARSEO',
        '3 HP:CB997A COMPATIBLE TONER PROPUESTA PARSEO',
        '3 HP:CB998A COMPATIBLE TONER PROPUESTA PARSEO',
        '3 HP:CE998A COMPATIBLE TONER PROPUESTA PARSEO',
        '4 Brother:DR-998 COMPATIBLE DRUM PROPUESTA PARSEO',
      ].sort(),
    );
    expect(filas.find((f) => f.cartridge.code === 'PG-999XL')?.evidence).toBe('PG-999 XL');
    expect(r.propuestasCreadas).toBe(7);
  });

  it('el cartucho se cuelga de la marca ORIGINAL aunque lo venda ASTA', async () => {
    const [ce998a] = await prisma.cartridge.findMany({ where: { codeNormalized: 'ce998a' }, include: { brand: true } });
    expect(ce998a.brand.name).toBe('HP');
  });
});

describe('#56 · Volver a importar no toca nada', () => {
  it('la misma entrada no crea nada nuevo', async () => {
    const r = await importarPropuestas(PRODUCTOS);
    expect(r).toMatchObject({ marcasCreadas: 0, cartuchosCreados: 0, propuestasCreadas: 0, propuestasExistentes: 7 });
  });

  it('una VALIDADA y una RECHAZADA siguen igual, con su revisor y su fecha', async () => {
    const filas = await propuestasDePrueba();
    const [a, b] = filas;
    const cuando = new Date('2026-09-01T10:00:00Z');
    await prisma.productCartridge.update({
      where: { odooProductTmplId_cartridgeId: { odooProductTmplId: a.odooProductTmplId, cartridgeId: a.cartridgeId } },
      data: { status: 'VALIDADA', reviewedAt: cuando, evidence: 'revisado a mano' },
    });
    await prisma.productCartridge.update({
      where: { odooProductTmplId_cartridgeId: { odooProductTmplId: b.odooProductTmplId, cartridgeId: b.cartridgeId } },
      data: { status: 'RECHAZADA', reviewedAt: cuando },
    });

    await importarPropuestas(PRODUCTOS);

    const despues = await propuestasDePrueba();
    const va = despues.find((f) => f.cartridgeId === a.cartridgeId && f.odooProductTmplId === a.odooProductTmplId)!;
    const vb = despues.find((f) => f.cartridgeId === b.cartridgeId && f.odooProductTmplId === b.odooProductTmplId)!;
    expect([va.status, va.evidence, va.reviewedAt?.toISOString()]).toEqual(['VALIDADA', 'revisado a mano', cuando.toISOString()]);
    expect([vb.status, vb.reviewedAt?.toISOString()]).toEqual(['RECHAZADA', cuando.toISOString()]);
  });

  it('el tipo de un cartucho existente no se corrige: pudo corregirlo una persona', async () => {
    // Sobre el cartucho de PRUEBA: modificar uno real es lo que hacía la primera versión.
    await prisma.cartridge.updateMany({ where: { codeNormalized: 'pg999xl' }, data: { kind: 'OTRO' } });
    await importarPropuestas(PRODUCTOS);
    const [c] = await prisma.cartridge.findMany({ where: { codeNormalized: 'pg999xl' } });
    expect(c.kind).toBe('OTRO');
  });

  it('un producto nuevo solo añade lo suyo', async () => {
    const r = await importarPropuestas([...PRODUCTOS, NUEVO]);
    expect(r.propuestasCreadas).toBe(1);
    expect(r.cartuchosCreados).toBe(1);
  });
});

describe('#56 · Reglas de relación y tipo', () => {
  const candidato = (nombre: string, ref: string | false | null) => extraerCartuchos(nombre, ref || null)[0];

  it('ORIGINAL solo si dice la marca del cartucho y nada indica compatible', () => {
    const p = P(10, 'HP TONER 105A NEGRO ORIGINAL', 'W1105A');
    expect(relacionConCartucho(p, candidato(p.name, p.default_code))).toBe('ORIGINAL');
  });

  it('ASTA, prefijo A- o "compatible" → COMPATIBLE', () => {
    for (const p of [
      P(11, 'ASTA TONER HP W1500A', 'A-W1500A'),
      P(12, 'TONER HP W1500A', 'A-W1500A'),
      P(13, 'TONER COMPATIBLE HP W1500A', 'W1500A-C'),
    ]) {
      expect(relacionConCartucho(p, candidato(p.name, p.default_code)), p.name).toBe('COMPATIBLE');
    }
  });

  it('ante la duda COMPATIBLE: el nombre no dice la marca del cartucho', () => {
    // CF230A es de HP, pero el producto no dice HP: no se afirma que sea original.
    const p = P(14, 'TONER CF230A NEGRO', 'CF230A');
    expect(relacionConCartucho(p, candidato(p.name, p.default_code))).toBe('COMPATIBLE');
  });

  it.each([
    ['ASTA DRUM OPC HP W1105A/105A ', 'DRUM'],
    ['CANON GPR-58 - TAMBOR DE IMAGEN', 'DRUM'],
    ['ASTA CARTUCHO DE TONER BROTHER DE ULTRA ALTO BLACK', 'TONER'],
    ['ASTA POLVO TONER POWDER CF226A/CRG-052 NEGRO', 'TONER'],
    ['HP CARTUCHO 667 BLACK ', 'TINTA'],
    ['CANON BOTELLA DE TINTA GI-190 -  NEGRO', 'TINTA'],
    ['CANON KIT DE CABEZAL BH-1 NEGRO', 'OTRO'],
  ] as const)('tipo de "%s" → %s', (nombre, tipo) => {
    expect(tipoDeCartucho(nombre)).toBe(tipo);
  });
});
