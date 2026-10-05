import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { leerCsv } from '../utils/csv.js';
import { importarPropuestas, type ProductoOdoo } from '../services/recomendador/importarPropuestas.js';
import { aplicarValidacion, planificarValidacion, resolverRevisor, type Revisor } from '../services/recomendador/validarPropuestas.js';

/**
 * #56 · Validación de propuestas desde un CSV revisado, contra MySQL.
 *
 * Es el paso que convierte una inferencia en algo que el kiosco le enseña a un
 * cliente. Lo que se vigila:
 *
 *   · planificar no escribe;
 *   · un error en una fila impide aplicar TODAS;
 *   · una decisión tomada no se cambia sin permiso explícito;
 *   · si la base cambió entre planificar y aplicar, no se aplica nada;
 *   · queda quién validó y cuándo, y solo puede ser un SUPERADMIN activo.
 *
 * Aislado como `importarPropuestas.test.ts`: códigos que no existen e ids de
 * producto ficticios, y solo se borra lo creado aquí.
 */

const P = (id: number, name: string, default_code: string): ProductoOdoo => ({ id: 999_100_000 + id, name, default_code });
const PRODUCTOS = [
  P(1, 'CANON  CARTUCHO DE TINTA PG-996 XL -NEGRO', '9996B001AA'),
  P(2, 'HP TONER 996A NEGRO ORIGINAL', 'W9996A'),
  P(3, 'ASTA TONER CE996A NEGRO', 'A-CE996A'),
];
/** Existe "en Odoo" pero el extractor no le encontró cartucho: captura manual. */
const SIN_CANDIDATO = P(4, 'TONER PARA LA KX-FL996', 'KXFA996');
const IDS = [...PRODUCTOS, SIN_CANDIDATO].map((p) => p.id);
const CODIGOS = ['pg996xl', '996a', 'w9996a', 'ce996a', 'kxfa996'];
const EMAILS = ['test.validar.admin@validar.local', 'test.validar.vendedor@validar.local', 'test.validar.inactivo@validar.local'];

const odoo = async (ids: number[]) => [...PRODUCTOS, SIN_CANDIDATO].filter((p) => ids.includes(p.id));
const id = (n: number) => String(999_100_000 + n);

let revisor: Revisor;

function csv(filas: string[]): ReturnType<typeof leerCsv> {
  return leerCsv(['odoo_product_tmpl_id,marca,codigo,decision,nota', ...filas].join('\n'));
}

async function estado(tmpl: number, codigoNormalizado: string) {
  const [f] = await prisma.productCartridge.findMany({
    where: { odooProductTmplId: 999_100_000 + tmpl, cartridge: { codeNormalized: codigoNormalizado } },
  });
  return f;
}

beforeAll(async () => {
  const ya = await prisma.cartridge.count({ where: { codeNormalized: { in: CODIGOS } } });
  if (ya > 0) throw new Error('Los cartuchos de prueba ya existen en la base: límpialos a mano.');
  await prisma.appUser.createMany({
    data: [
      { email: EMAILS[0], fullName: 'Admin validación', role: 'SUPERADMIN', isActive: true, odooPartnerId: 999_100_101 },
      { email: EMAILS[1], fullName: 'Vendedor', role: 'VENDEDOR', isActive: true, odooUserId: 999_100_001, odooPartnerId: 999_100_102 },
      { email: EMAILS[2], fullName: 'Inactivo', role: 'SUPERADMIN', isActive: false, odooPartnerId: 999_100_103 },
    ],
  });
  revisor = await resolverRevisor(EMAILS[0]);
});

afterEach(async () => {
  // Cada test parte de las mismas tres propuestas, recién importadas.
  await prisma.productCartridge.deleteMany({ where: { odooProductTmplId: { in: IDS } } });
  await prisma.cartridge.deleteMany({ where: { codeNormalized: { in: CODIGOS } } });
});

afterAll(async () => {
  await prisma.appUser.deleteMany({ where: { email: { in: EMAILS } } });
  await prisma.$disconnect();
});

const importar = () => importarPropuestas(PRODUCTOS);

describe('#56 · Planificar no escribe', () => {
  it('el plan dice qué haría, y la base sigue igual', async () => {
    await importar();
    const plan = await planificarValidacion(csv([`${id(1)},Canon,PG-996XL,VALIDADA,`, `${id(2)},HP,996A,RECHAZADA,`, `${id(2)},HP,W9996A,,`]), { buscarProductos: odoo });
    expect(plan.errores).toEqual([]);
    expect(plan.sinDecidir).toBe(1);
    expect(plan.acciones.map((a) => [a.tipo, a.decision])).toEqual([['DECIDIR', 'VALIDADA'], ['DECIDIR', 'RECHAZADA']]);
    expect((await estado(1, 'pg996xl')).status).toBe('PROPUESTA');
  });
});

describe('#56 · Aplicar', () => {
  it('deja la decisión, el revisor, la fecha y la nota junto a la evidencia', async () => {
    await importar();
    const plan = await planificarValidacion(csv([`${id(1)},canon,PG-996 XL,validada,miré la ficha de Canon`, `${id(3)},HP,CE996A,RECHAZADA,`]), { buscarProductos: odoo });
    const cuando = new Date('2026-09-16T12:00:00Z');
    const r = await aplicarValidacion(plan, revisor, cuando);
    expect(r).toEqual({ decididas: 2, creadasManuales: 0, sinCambio: 0 });

    const v = await estado(1, 'pg996xl');
    expect([v.status, v.reviewedBy, v.reviewedAt?.toISOString(), v.evidence]).toEqual(['VALIDADA', revisor.id, cuando.toISOString(), 'PG-996 XL · Revisión: miré la ficha de Canon']);
    expect((await estado(3, 'ce996a')).status).toBe('RECHAZADA');
  });

  it('volver a aplicar el mismo archivo no cambia nada', async () => {
    await importar();
    const filas = csv([`${id(1)},Canon,PG-996XL,VALIDADA,`]);
    await aplicarValidacion(await planificarValidacion(filas, { buscarProductos: odoo }), revisor);
    const antes = await estado(1, 'pg996xl');

    const plan = await planificarValidacion(filas, { buscarProductos: odoo });
    expect(plan.acciones.map((a) => a.tipo)).toEqual(['SIN_CAMBIO']);
    await aplicarValidacion(plan, revisor, new Date('2030-01-01'));
    expect((await estado(1, 'pg996xl')).reviewedAt).toEqual(antes.reviewedAt);
  });
});

describe('#56 · Un error en una fila impide aplicar todas', () => {
  it('cada tipo de fila inválida, con su línea', async () => {
    await importar();
    const plan = await planificarValidacion(
      csv([
        `${id(1)},Canon,PG-996XL,VALIDADA,`, // línea 2: válida
        `${id(2)},HP,996A,SI,`, // 3
        `abc,HP,996A,VALIDADA,`, // 4
        // Una marca que NO está en `printer_brands`. Antes decía «Xerox», y el
        // test envejeció: los importadores la crearon, así que hoy es válida.
        // Las marcas conocidas salen de la base y crecen con los datos.
        `${id(2)},ZZ_MARCA_INEXISTENTE,996A,VALIDADA,`, // 5
        `${id(2)},HP,,VALIDADA,`, // 6
      ]),
      { buscarProductos: odoo },
    );
    expect(plan.errores.map((e) => e.linea)).toEqual([3, 4, 5, 6]);
    await expect(aplicarValidacion(plan, revisor)).rejects.toThrow(/errores: no se aplica nada/);
    // Tampoco la fila válida.
    expect((await estado(1, 'pg996xl')).status).toBe('PROPUESTA');
  });

  it('la misma propuesta con dos decisiones distintas es un error', async () => {
    await importar();
    const plan = await planificarValidacion(csv([`${id(1)},Canon,PG-996XL,VALIDADA,`, `${id(1)},Canon,pg-996xl,RECHAZADA,`]), { buscarProductos: odoo });
    expect(plan.errores).toEqual([expect.objectContaining({ linea: 3, mensaje: expect.stringMatching(/contradice la línea 2/) })]);
  });

  it('faltan columnas → error, no filas ignoradas en silencio', async () => {
    const plan = await planificarValidacion(leerCsv('odoo_product_tmpl_id,marca,codigo\n1,HP,996A'), { buscarProductos: odoo });
    expect(plan.errores[0].mensaje).toMatch(/faltan columnas: decision/);
  });
});

describe('#56 · Una decisión tomada no se cambia sin permiso', () => {
  it('RECHAZADA sobre algo VALIDADO es error; con permitirCambios se aplica', async () => {
    await importar();
    await aplicarValidacion(await planificarValidacion(csv([`${id(1)},Canon,PG-996XL,VALIDADA,`]), { buscarProductos: odoo }), revisor);

    const sinPermiso = await planificarValidacion(csv([`${id(1)},Canon,PG-996XL,RECHAZADA,`]), { buscarProductos: odoo });
    expect(sinPermiso.errores[0].mensaje).toMatch(/ya estaba VALIDADA.*--permitir-cambios/);

    const conPermiso = await planificarValidacion(csv([`${id(1)},Canon,PG-996XL,RECHAZADA,`]), { buscarProductos: odoo, permitirCambios: true });
    await aplicarValidacion(conPermiso, revisor);
    expect((await estado(1, 'pg996xl')).status).toBe('RECHAZADA');
  });

  it('si la propuesta cambió entre planificar y aplicar, no se aplica NADA', async () => {
    await importar();
    const plan = await planificarValidacion(csv([`${id(2)},HP,996A,VALIDADA,`, `${id(1)},Canon,PG-996XL,VALIDADA,`]), { buscarProductos: odoo });
    // Otro revisor la rechaza mientras tanto.
    await prisma.productCartridge.updateMany({ where: { odooProductTmplId: 999_100_001 }, data: { status: 'RECHAZADA' } });

    await expect(aplicarValidacion(plan, revisor)).rejects.toThrow(/cambió desde que se planificó/);
    // La otra fila del plan, que sí podía aplicarse, tampoco entró: transacción.
    expect((await estado(2, '996a')).status).toBe('PROPUESTA');
  });
});

describe('#56 · Captura manual', () => {
  it('VALIDADA sin propuesta previa crea la compatibilidad como MANUAL y validada', async () => {
    await importar();
    const plan = await planificarValidacion(csv([`${id(4)},Samsung,KX-FA996,VALIDADA,lo dice la caja`]), { buscarProductos: odoo });
    expect(plan.acciones.map((a) => a.tipo)).toEqual(['CREAR_MANUAL']);
    const r = await aplicarValidacion(plan, revisor);
    expect(r.creadasManuales).toBe(1);

    const f = await prisma.productCartridge.findFirst({ where: { odooProductTmplId: 999_100_004 }, include: { cartridge: { include: { brand: true } } } });
    expect([f?.source, f?.status, f?.relation, f?.evidence, f?.reviewedBy, f?.cartridge.brand.name, f?.cartridge.code]).toEqual([
      'MANUAL',
      'VALIDADA',
      'COMPATIBLE',
      'lo dice la caja',
      revisor.id,
      'Samsung',
      'KX-FA996',
    ]);
  });

  it('un producto que no existe en Odoo no se puede capturar', async () => {
    const plan = await planificarValidacion(csv(['999999999,HP,996A,VALIDADA,']), { buscarProductos: odoo });
    expect(plan.errores[0].mensaje).toMatch(/no existe en Odoo/);
  });

  it('RECHAZADA sin propuesta previa es un aviso, no una acción', async () => {
    const plan = await planificarValidacion(csv([`${id(4)},HP,996A,RECHAZADA,`]), { buscarProductos: odoo });
    expect(plan.acciones).toEqual([]);
    expect(plan.avisos[0].mensaje).toMatch(/no hay nada que rechazar/);
  });
});

describe('#56 · Revisor', () => {
  it('solo un SUPERADMIN activo', async () => {
    await expect(resolverRevisor(EMAILS[1])).rejects.toThrow(/VENDEDOR.*exige SUPERADMIN/);
    await expect(resolverRevisor(EMAILS[2])).rejects.toThrow(/desactivado/);
    await expect(resolverRevisor('nadie@validar.local')).rejects.toThrow(/No existe/);
    expect((await resolverRevisor('  TEST.VALIDAR.ADMIN@validar.local ')).id).toBe(revisor.id);
  });
});

describe('#56 · De Excel a la base', () => {
  it('un CSV guardado desde Excel en español se aplica igual', async () => {
    await importar();
    const excel = `\uFEFFodoo_product_tmpl_id;default_code;nombre;importe_12m;marca;codigo;evidencia;estado_actual;decision;nota\r\n${id(1)};9996B001AA;"CANON CARTUCHO; TINTA";0;Canon;PG-996XL;PG-996 XL;PROPUESTA;VALIDADA;\r\n`;
    const plan = await planificarValidacion(leerCsv(excel), { buscarProductos: odoo });
    await aplicarValidacion(plan, revisor);
    expect((await estado(1, 'pg996xl')).status).toBe('VALIDADA');
  });
});
