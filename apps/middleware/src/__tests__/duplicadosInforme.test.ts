import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

/**
 * #50 · El informe de fusiones pendientes que se sirve al panel.
 *
 * La detección ya está probada en `duplicados.test.ts` con lógica pura. Lo que se
 * vigila aquí es el tramo que la lleva de Odoo a la pantalla, donde están los
 * errores que no se ven al mirar el código:
 *
 *   · QUÉ se le pide a Odoo. El informe solo tiene sentido sobre clientes de
 *     primer nivel activos: si entran las sucursales, cada cliente con dos
 *     tiendas aparece como duplicado y a la tercera fila nadie lo cree.
 *   · QUÉ sale. Solo los grupos partidos, que son los que rompen el panel. Los
 *     inofensivos cuentan en el resumen y no ocupan la lista.
 *   · QUIÉN lo ve. Es la instancia entera —nombres de clientes, facturación y
 *     cartera de cada uno—, así que un vendedor NO.
 *
 * Odoo va simulado: el informe real son ~8.800 clientes y una agrupación sobre
 * todas las facturas, y con datos fijos se pueden comprobar los tres tipos de
 * grupo y el cruce de carteras. MySQL es el de verdad, para las sesiones.
 */

const searchRead = vi.fn();
const readGroup = vi.fn();

vi.mock('../odoo/client.js', async (original) => {
  const real = await original<typeof import('../odoo/client.js')>();
  return { ...real, searchRead, readGroup };
});

const { prisma } = await import('../config/prisma.js');
const { createApp } = await import('../server.js');
const { emitirAccessToken } = await import('../auth/jwt.js');
const { caducaEnDias, hashSecreto } = await import('../auth/tokens.js');
const { informeDeDuplicados, vaciarCacheDuplicados } = await import('../services/duplicados.service.js');
const { informeDuplicadosRespuestaSchema } = await import('@asta/shared-types');

/**
 * Seis clientes que cubren los tres tipos de grupo.
 *
 *   1 y 2   mismo RIF, facturación REPARTIDA y vendedores DISTINTOS → sale
 *   3 y 4   mismo nombre, todo facturado en uno → inocuo, no sale
 *   5 y 6   mismo RIF, sin una sola factura → ruido, no sale
 */
const PARTNERS = [
  { id: 101, name: 'ZZ PARTIDO, C.A.', vat: 'J-40000001-1', user_id: [7, 'Ana'] as [number, string] },
  { id: 102, name: 'ZZ PARTIDO CA', vat: 'J40000001 1', user_id: [8, 'Beto'] as [number, string] },
  { id: 103, name: 'ZZ INOCUO, C.A.', vat: false as const, user_id: [7, 'Ana'] as [number, string] },
  { id: 104, name: 'ZZ INOCUO CA', vat: false as const, user_id: false as const },
  { id: 105, name: 'ZZ VACIO UNO', vat: 'J-40000002-2', user_id: false as const },
  { id: 106, name: 'ZZ VACIO DOS', vat: 'J40000002-2', user_id: false as const },
];

/** 102 factura MÁS que 101: el destino de la fusión no es el id más bajo. */
const FACTURACION: Array<[number, number, number]> = [
  [101, 1_000, 3],
  [102, 4_000, 12],
  [103, 9_000, 20],
  // 104 sin facturas: por eso el grupo 103+104 es inocuo y no partido.
];

function odooSimulado(): void {
  searchRead.mockImplementation(async (modelo: string) => {
    if (modelo === 'res.partner') return PARTNERS;
    throw new Error(`consulta inesperada: ${modelo}`);
  });
  readGroup.mockImplementation(async (modelo: string) => {
    if (modelo !== 'account.move') throw new Error(`agrupación inesperada: ${modelo}`);
    return FACTURACION.map(([id, monto, cuenta]) => ({
      commercial_partner_id: [id, `partner ${id}`],
      amount_total_signed: monto,
      __count: cuenta,
    }));
  });
}

beforeEach(() => {
  searchRead.mockReset();
  readGroup.mockReset();
  vaciarCacheDuplicados();
  odooSimulado();
});

describe('#50 · Qué se le pide a Odoo', () => {
  it('solo clientes de PRIMER NIVEL y activos: una sucursal no es un duplicado', async () => {
    await informeDeDuplicados();

    const [modelo, dominio] = searchRead.mock.calls[0];
    expect(modelo).toBe('res.partner');
    expect(dominio).toEqual(
      expect.arrayContaining([
        ['customer_rank', '>', 0],
        ['parent_id', '=', false],
        ['active', '=', true],
      ]),
    );
  });

  it('la facturación son facturas de venta CONTABILIZADAS, en una sola agrupación', async () => {
    await informeDeDuplicados();

    expect(readGroup).toHaveBeenCalledTimes(1);
    const [modelo, dominio, campos, agrupar] = readGroup.mock.calls[0];
    expect(modelo).toBe('account.move');
    expect(dominio).toEqual(
      expect.arrayContaining([
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
      ]),
    );
    expect(campos).toEqual(['amount_total_signed:sum']);
    expect(agrupar).toEqual(['commercial_partner_id']);
  });
});

describe('#50 · Qué sale en el informe', () => {
  it('solo los grupos con la facturación REPARTIDA', async () => {
    const r = await informeDeDuplicados();

    // El inocuo (103+104) y el vacío (105+106) cuentan en el resumen y NO ocupan
    // la lista: son el 79 % de los grupos y no distorsionan ninguna cifra.
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].registros.map((g) => g.partnerId)).toEqual([102, 101]);
    expect(r.resumen).toMatchObject({
      registros: 6,
      grupos: 3,
      partidos: 1,
      inocuos: 1,
      sinFacturas: 1,
      partidosEntreVendedores: 1,
    });
  });

  it('marca como destino el registro con MÁS facturación, no el id más bajo', async () => {
    const [g] = (await informeDeDuplicados()).grupos;

    expect(g.registros.filter((r) => r.esDestino).map((r) => r.partnerId)).toEqual([102]);
    expect(g.montoTotal).toBe(5_000);
    // Lo que hay que mover: todo lo que no está ya en el destino.
    expect(g.montoFuera).toBe(1_000);
  });

  it('dice que el grupo cruza carteras, con los nombres', async () => {
    const [g] = (await informeDeDuplicados()).grupos;

    // Sin los nombres el aviso no sirve: «habla con Ana y Beto» es accionable,
    // «este grupo cruza carteras» no.
    expect(g.vendedores).toEqual(expect.arrayContaining(['Ana', 'Beto']));
    expect(g.vendedores).toHaveLength(2);
  });

  it('el motivo y la clave dicen por qué son el mismo cliente', async () => {
    const [g] = (await informeDeDuplicados()).grupos;

    // El RIF identifica; el nombre solo se parece. La clave es el RIF
    // normalizado, que es lo que se pega en Odoo para encontrarlos.
    expect(g.motivo).toBe('rif');
    expect(g.clave).toBe('J400000011');
  });

  it('cuánta facturación está atrapada, y cuánta hay en total', async () => {
    const { resumen } = await informeDeDuplicados();

    expect(resumen.montoPartido).toBe(5_000);
    expect(resumen.montoTotalFacturado).toBe(14_000);
  });

  it('cuántas fusiones cubren cada porcentaje del dinero repartido', async () => {
    const { fusionesPara } = await informeDeDuplicados();

    // Con un solo grupo partido, una fusión cubre el 100 %. Lo que fija el test
    // es que los cuatro objetivos VIENEN, porque son ellos los que convierten el
    // informe en una tarea con final.
    expect(fusionesPara.map((f) => f.porcentaje)).toEqual([50, 80, 90, 95]);
    expect(fusionesPara.every((f) => f.fusiones === 1)).toBe(true);
  });

  it('sin duplicados no se inventa nada', async () => {
    searchRead.mockImplementation(async () => [PARTNERS[0]]);
    const r = await informeDeDuplicados();

    expect(r.grupos).toEqual([]);
    expect(r.resumen).toMatchObject({ registros: 1, grupos: 0, partidos: 0, montoPartido: 0 });
    expect(r.fusionesPara.every((f) => f.fusiones === 0)).toBe(true);
  });
});

describe('#50 · La cache', () => {
  it('no vuelve a Odoo, y la respuesta lo dice', async () => {
    const primero = await informeDeDuplicados();
    const segundo = await informeDeDuplicados();

    expect(searchRead).toHaveBeenCalledTimes(1);
    expect(primero.desdeCache).toBe(false);
    expect(segundo.desdeCache).toBe(true);
    // Misma fecha: la de cuando se leyó Odoo, no la de ahora. Un informe de hace
    // 50 minutos fechado ahora mismo es peor que uno fechado.
    expect(segundo.generadoEn).toBe(primero.generadoEn);
  });

  it('al vaciarla, vuelve a leer', async () => {
    await informeDeDuplicados();
    vaciarCacheDuplicados();
    await informeDeDuplicados();

    expect(searchRead).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El endpoint
// ─────────────────────────────────────────────────────────────────────────────

let server: Server;
let base = '';
let comprobado = false;
const usuarios: string[] = [];
const tokens: Record<'admin' | 'vendedor', string> = { admin: '', vendedor: '' };

async function usuarioConToken(rol: 'SUPERADMIN' | 'VENDEDOR', sufijo: string) {
  const u = await prisma.appUser.create({
    data: {
      email: `test.dup.${sufijo}@duplicados.local`,
      fullName: `Duplicados ${sufijo}`,
      role: rol,
      odooPartnerId: 3_900_000_000 + usuarios.length,
      isActive: true,
    },
  });
  usuarios.push(u.id);
  const sesion = await prisma.userSession.create({
    data: {
      userId: u.id,
      refreshTokenHash: hashSecreto(`dup-${sufijo}-${Date.now()}-${Math.random()}`),
      expiresAt: caducaEnDias(1),
    },
    select: { id: true },
  });
  return emitirAccessToken({ sub: u.id, role: rol, odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
}

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@duplicados.local' } } })) {
    throw new Error('Restos de @duplicados.local en la base: límpialos a mano.');
  }
  comprobado = true;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  tokens.admin = await usuarioConToken('SUPERADMIN', 'admin');
  tokens.vendedor = await usuarioConToken('VENDEDOR', 'vendedor');
}, 60_000);

afterAll(async () => {
  if (comprobado && usuarios.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: usuarios } } });
    await prisma.appUser.deleteMany({ where: { id: { in: usuarios } } });
  }
  vaciarCacheDuplicados();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

const pedir = (quien: keyof typeof tokens) =>
  fetch(`${base}/api/v1/admin/duplicados`, { headers: { Authorization: `Bearer ${tokens[quien]}` } });

describe('#50 · GET /admin/duplicados', () => {
  it('un vendedor NO: el informe es la cartera de todos sus compañeros', async () => {
    const res = await pedir('vendedor');
    expect(res.status).toBe(403);
    // Y no llega a consultar Odoo: el permiso se comprueba antes.
    expect(searchRead).not.toHaveBeenCalled();
  });

  it('sin token tampoco', async () => {
    expect((await fetch(`${base}/api/v1/admin/duplicados`)).status).toBe(401);
  });

  it('el administrador lo recibe y cumple el contrato', async () => {
    const res = await pedir('admin');
    expect(res.status).toBe(200);

    const cuerpo = await res.json();
    const parseado = informeDuplicadosRespuestaSchema.safeParse(cuerpo);
    expect(parseado.success, JSON.stringify(parseado.error?.issues ?? [])).toBe(true);

    expect(parseado.data!.data.resumen.partidos).toBe(1);
    expect(parseado.data!.meta.desdeCache).toBe(false);
  });

  it('la segunda carga sale de la cache, y la respuesta lo dice', async () => {
    await pedir('admin');
    const cuerpo = (await (await pedir('admin')).json()) as { meta: { desdeCache: boolean } };

    expect(cuerpo.meta.desdeCache).toBe(true);
  });
});
