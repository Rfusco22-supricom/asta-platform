import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AppRole } from '@asta/shared-types';
import { createApp } from '../server.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';
import { prisma } from '../config/prisma.js';
import { emitirAccessToken } from '../auth/jwt.js';
import { caducaEnDias, hashSecreto } from '../auth/tokens.js';

/**
 * Issue #25 — AISLAMIENTO ENTRE CARTERAS DE VENDEDORES
 *
 * Este es uno de los dos gates de seguridad del proyecto, y **bloquea el cierre
 * de la Fase 3**.
 *
 * Pesa más de lo que parece: al salir de Supabase desapareció el RLS, que era la
 * segunda línea de defensa. Ahora, si el scoping del middleware falla, no hay
 * nada detrás. Estos tests son lo único que hay entre un `where` olvidado y que
 * un vendedor vea la facturación de la cartera de otro.
 *
 * ── Por qué contra Odoo real ─────────────────────────────────────────────────
 *
 * Con datos inventados uno acaba probando el caso que ya tenía en la cabeza. Las
 * fixtures se DESCUBREN de la instancia, así que los tests se topan con la forma
 * real de los datos: sucursales sin vendedor propio, sucursales asignadas a un
 * vendedor distinto al de su matriz, clientes sin facturas.
 *
 * Si un caso no existe en la instancia, el test lo dice en vez de pasar en
 * silencio: un test que se salta sin avisar es peor que no tenerlo.
 */

let server: Server;
let base: string;
const auditados: AuditEvent[] = [];
let quitarSink: () => void;

interface Fixtures {
  vendedorA: number;
  vendedorB: number;
  nombreA: string;
  nombreB: string;
  clienteDeA: number;
  clienteDeB: number;
  /**
   * Sucursal cuya matriz pertenece a ALGUIEN QUE NO ES A. El caso que se escapa.
   *
   * No se busca "una sucursal de B" a secas: el segundo vendedor por tamaño de
   * cartera resultó no tener ninguna, y el test más importante quedaba sin
   * ejecutarse. Se busca entre TODOS los vendedores con sucursales.
   */
  sucursalAjena: { id: number; duenio: number } | null;
  /** Sucursal sin vendedor propio + el vendedor de su matriz. Prueba la escalada. */
  sucursalHeredada: { id: number; vendedorDeLaMatriz: number } | null;
  /**
   * Cliente RAIZ —sin matriz— y SIN vendedor asignado.
   *
   * En `assertSalespersonOwnsPartner` toma un camino que ningun otro caso
   * ejercita: no coincide el vendedor, y como `commercialPartnerId === id` no hay
   * matriz a la que subir, asi que cae directo en el 403. La revision cruzada
   * de #25 lo encontro por mutacion: con ese camino saboteado para devolver el
   * cliente, la bateria entera seguia en verde. Son el ~10% de la cartera.
   */
  clienteSinVendedor: number | null;
}

let fx: Fixtures;

// ─────────────────────────────────────────────────────────────────────────────

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as { error?: { code?: string } } | null };
}

/**
 * Sesiones REALES para los tests.
 *
 * Antes estos tests usaban una cabecera de desarrollo que fabricaba identidades
 * sin verificar nada. Ese bypass está borrado (#17).
 *
 * Ahora se crea una fila en `user_sessions` y se firma un JWT de verdad: los
 * tests recorren `authJwt()` completo —firma, caducidad, emisor, sesión viva en
 * base, rol leído de la base— que es exactamente lo que corre en producción.
 *
 * No se pasa por `login()` a propósito. Haría falta fijar una contraseña sobre
 * usuarios que ya existen (los del seed de desarrollo, que comparten el
 * `odooUserId` de los vendedores reales) y el test destruiría datos que no son
 * suyos. Lo que estos tests prueban es el SCOPING, no el formulario de login;
 * ese tiene los suyos en auth.test.ts.
 */
const tokens = new Map<string, string>();
const usuariosCreados: string[] = [];

const claveDe = (rol: AppRole, sufijo = '') => `${rol}${sufijo}`;

/**
 * Los vendedores se indexan por su `res.users.id` de Odoo, no por A/B.
 *
 * Las fixtures se descubren de la instancia, así que el dueño de una sucursal
 * puede ser CUALQUIER vendedor, no solo los dos de mayor cartera. Mapear "todo
 * lo que no es A es B" hacía que dos tests mandaran el token equivocado y
 * fallaran con un 403 que parecía un problema de scoping y era del arnés.
 */
const claveVendedor = (odooUserId: number) => `v:${odooUserId}`;

async function prepararIdentidad(
  rol: AppRole,
  odooUserId: number | null,
  partnerFicticio: number,
  sufijo = '',
): Promise<void> {
  // Si ya hay un usuario con ese odooUserId (los del seed), se reutiliza: la
  // columna es UNIQUE y crear otro fallaría.
  let usuario =
    odooUserId !== null
      ? await prisma.appUser.findUnique({ where: { odooUserId } })
      : null;

  if (!usuario) {
    const email = `test.${claveDe(rol, sufijo).toLowerCase()}@aislamiento.local`;
    usuario = await prisma.appUser.upsert({
      where: { email },
      create: {
        email,
        fullName: `Test ${rol}${sufijo}`,
        role: rol,
        odooPartnerId: partnerFicticio,
        odooUserId,
        isActive: true,
      },
      update: { role: rol, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  } else if (usuario.role !== rol) {
    // El del seed es VENDEDOR; si el test lo necesita con otro rol, no se toca:
    // se crea uno aparte sin odooUserId.
    const email = `test.${claveDe(rol, sufijo).toLowerCase()}@aislamiento.local`;
    usuario = await prisma.appUser.upsert({
      where: { email },
      create: {
        email,
        fullName: `Test ${rol}${sufijo}`,
        role: rol,
        odooPartnerId: partnerFicticio,
        odooUserId: null,
        isActive: true,
      },
      update: { role: rol, isActive: true },
    });
    usuariosCreados.push(usuario.id);
  }

  const sesion = await prisma.userSession.create({
    data: {
      userId: usuario.id,
      refreshTokenHash: hashSecreto(`test-${rol}${sufijo}-${Date.now()}-${Math.random()}`),
      expiresAt: caducaEnDias(1),
    },
    select: { id: true },
  });

  tokens.set(
    rol === 'VENDEDOR' && odooUserId !== null ? claveVendedor(odooUserId) : claveDe(rol, sufijo),
    await emitirAccessToken({
      sub: usuario.id,
      role: rol,
      odooPartnerId: usuario.odooPartnerId,
      odooUserId: usuario.odooUserId,
      sid: sesion.id,
    }),
  );
}

const bearer = (clave: string) => ({ Authorization: `Bearer ${tokens.get(clave)}` });

/** Vendedor A o B, por su res.users.id de Odoo. */
const comoVendedor = (uid: number) => bearer(claveVendedor(uid));

/** Cualquier otro rol. El rol viaja en el token Y se re-lee de la base. */
const comoRol = (_uid: number, rol: string) => bearer(rol);

async function descubrirFixtures(): Promise<Fixtures> {
  const vendedores = await readGroup<{ user_id: [number, string]; __count: number }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['user_id', '!=', false],
      ['parent_id', '=', false],
    ],
    [],
    ['user_id'],
  );
  vendedores.sort((a, b) => b.__count - a.__count);
  if (vendedores.length < 2) throw new Error('La instancia necesita 2 vendedores con cartera');

  const [A, B] = vendedores;

  const traerCliente = async (uid: number) => {
    const rows = await searchRead<{ id: number }>(
      'res.partner',
      [
        ['user_id', '=', uid],
        ['parent_id', '=', false],
        ['active', '=', true],
      ],
      ['id'],
      { limit: 1 },
    );
    return rows[0]?.id ?? 0;
  };

  // Sucursal cuya matriz pertenece a alguien distinto de A.
  //
  // En dos pasos y no con un dominio del tipo `commercial_partner_id.user_id`:
  // esa travesía por punto devuelve vacío en esta instancia.
  const sucursales = await searchRead<{ id: number; parent_id: [number, string] }>(
    'res.partner',
    [
      ['parent_id', '!=', false],
      ['active', '=', true],
    ],
    ['id', 'parent_id'],
    { limit: 200 },
  );
  const idsMatrices = [...new Set(sucursales.map((h) => h.parent_id[0]))];
  const matrices = new Map<number, number | null>();
  for (let i = 0; i < idsMatrices.length; i += 200) {
    const rows = await searchRead<{ id: number; user_id: [number, string] | false }>(
      'res.partner',
      [['id', 'in', idsMatrices.slice(i, i + 200)]],
      ['id', 'user_id'],
    );
    for (const r of rows) matrices.set(r.id, r.user_id ? r.user_id[0] : null);
  }

  let sucursalAjena: Fixtures['sucursalAjena'] = null;
  for (const h of sucursales) {
    const duenio = matrices.get(h.parent_id[0]);
    if (duenio && duenio !== A.user_id[0]) {
      sucursalAjena = { id: h.id, duenio };
      break;
    }
  }

  // Sucursal SIN vendedor propio cuya matriz sí tiene uno: solo estas ejercitan
  // la escalada por commercial_partner_id.
  let heredada: Fixtures['sucursalHeredada'] = null;
  const huerfanas = await searchRead<{ id: number; parent_id: [number, string] }>(
    'res.partner',
    [
      ['parent_id', '!=', false],
      ['active', '=', true],
      ['user_id', '=', false],
    ],
    ['id', 'parent_id'],
    { limit: 40 },
  );
  for (const h of huerfanas) {
    const madre = await searchRead<{ id: number; user_id: [number, string] | false }>(
      'res.partner',
      [['id', '=', h.parent_id[0]]],
      ['id', 'user_id'],
    );
    if (madre[0]?.user_id) {
      heredada = { id: h.id, vendedorDeLaMatriz: madre[0].user_id[0] };
      break;
    }
  }

  // Cliente raiz sin vendedor. Se exige `commercial_partner_id === id` y no solo
  // `parent_id = false`: lo que se quiere probar es el camino SIN matriz a la que
  // subir, y un partner sin padre no garantiza por si solo ser su propia
  // entidad comercial.
  const candidatosSinVendedor = await searchRead<{
    id: number;
    commercial_partner_id: [number, string] | false;
  }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['parent_id', '=', false],
      ['user_id', '=', false],
      ['active', '=', true],
    ],
    ['id', 'commercial_partner_id'],
    { limit: 40 },
  );
  const clienteSinVendedor =
    candidatosSinVendedor.find(
      (c) => !c.commercial_partner_id || c.commercial_partner_id[0] === c.id,
    )?.id ?? null;

  return {
    vendedorA: A.user_id[0],
    vendedorB: B.user_id[0],
    nombreA: A.user_id[1],
    nombreB: B.user_id[1],
    clienteDeA: await traerCliente(A.user_id[0]),
    clienteDeB: await traerCliente(B.user_id[0]),
    sucursalAjena,
    sucursalHeredada: heredada,
    clienteSinVendedor,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  quitarSink = registerAuditSink((e) => auditados.push(e));

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  fx = await descubrirFixtures();

  // Un usuario por rol. Los ids de Odoo son los de vendedores REALES para que el
  // scoping tenga datos sobre los que decidir; los partner id son ficticios y
  // altos, para no chocar con ninguno de la instancia.
  // Todos los vendedores que las fixtures descubran, no solo A y B: el dueño de
  // una sucursal puede ser cualquiera.
  const uidsVendedores = new Set<number>([fx.vendedorA, fx.vendedorB]);
  if (fx.sucursalAjena) uidsVendedores.add(fx.sucursalAjena.duenio);
  if (fx.sucursalHeredada) uidsVendedores.add(fx.sucursalHeredada.vendedorDeLaMatriz);

  let n = 0;
  for (const uid of uidsVendedores) {
    await prepararIdentidad('VENDEDOR', uid, 990_100 + n, `.${n}`);
    n++;
  }
  await prepararIdentidad('SUPERADMIN', null, 990_003);
  await prepararIdentidad('BRONCE', null, 990_004);
  await prepararIdentidad('PLATA', null, 990_005);
  await prepararIdentidad('GOLD', null, 990_006);
}, 240_000);

afterAll(async () => {
  quitarSink?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Solo se borra lo que ESTOS tests crearon. Los usuarios del seed de
  // desarrollo se reutilizan pero no se tocan: destruirlos haría que el panel
  // dejara de funcionar cada vez que alguien corre los tests.
  if (usuariosCreados.length > 0) {
    await prisma.appUser.deleteMany({ where: { id: { in: usuariosCreados } } });
  }
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#25 · Aislamiento entre carteras de vendedores', () => {
  it('las fixtures salen de datos reales de Odoo', () => {
    expect(fx.vendedorA).toBeGreaterThan(0);
    expect(fx.vendedorB).toBeGreaterThan(0);
    expect(fx.vendedorA).not.toBe(fx.vendedorB);
    expect(fx.clienteDeA).toBeGreaterThan(0);
    expect(fx.clienteDeB).toBeGreaterThan(0);
  });

  it('un vendedor SÍ puede ver a su propio cliente', async () => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeA}/invoicing`,
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(200);
  });

  it('NO puede ver a un cliente de otro vendedor', async () => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeB}/invoicing`,
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('PARTNER_NOT_IN_PORTFOLIO');
  });

  it('NO puede ver una SUCURSAL de un cliente de otro vendedor', async () => {
    // El caso que se escapa: la comprobación tiene que subir por
    // commercial_partner_id. Sin esa parte, pedir la sucursal en vez de la
    // matriz sería la puerta trasera.
    if (fx.sucursalAjena === null) {
      throw new Error(
        'No se encontró ninguna sucursal cuya matriz pertenezca a otro vendedor. ' +
          'El caso más peligroso queda SIN PROBAR: revísalo a mano antes de cerrar #25.',
      );
    }
    const r = await get(
      `/api/v1/salesperson/clients/${fx.sucursalAjena.id}/invoicing`,
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('PARTNER_NOT_IN_PORTFOLIO');
  });

  it('el dueño de la matriz SÍ puede ver esa sucursal', async () => {
    // La otra cara del test anterior: la escalada tiene que dejar pasar al
    // vendedor correcto, no solo bloquear al incorrecto.
    if (fx.sucursalAjena === null) return;
    const r = await get(
      `/api/v1/salesperson/clients/${fx.sucursalAjena.id}/invoicing`,
      comoVendedor(fx.sucursalAjena.duenio),
    );
    expect(r.status).toBe(200);
  });

  it('SÍ puede ver una sucursal sin vendedor propio cuya matriz es suya', async () => {
    // La otra cara: sin la escalada, un vendedor perdería acceso a las
    // sucursales de sus propios clientes.
    if (fx.sucursalHeredada === null) {
      throw new Error(
        'No hay sucursales sin vendedor propio con matriz asignada. La escalada ' +
          'por commercial_partner_id queda SIN PROBAR en el caso positivo.',
      );
    }
    const { id, vendedorDeLaMatriz } = fx.sucursalHeredada;
    const r = await get(
      `/api/v1/salesperson/clients/${id}/invoicing`,
      comoVendedor(vendedorDeLaMatriz),
    );
    expect(r.status).toBe(200);
  });

  it('un tercero NO puede ver esa misma sucursal heredada', async () => {
    if (fx.sucursalHeredada === null) return;
    const ajeno =
      fx.sucursalHeredada.vendedorDeLaMatriz === fx.vendedorA ? fx.vendedorB : fx.vendedorA;
    const r = await get(
      `/api/v1/salesperson/clients/${fx.sucursalHeredada.id}/invoicing`,
      comoVendedor(ajeno),
    );
    expect(r.status).toBe(403);
  });

  it('NINGÚN vendedor puede ver un cliente raíz sin vendedor asignado', async () => {
    // Un cliente sin vendedor no es "de todos": no es de nadie. Solo lo ve el
    // SUPERADMIN.
    //
    // Este camino —sin vendedor y sin matriz a la que subir— no lo ejercitaba
    // ningun otro test. Saboteado para devolver el cliente, las 36 pruebas de
    // esta bateria seguian en verde; la unica que cazaba un sabotaje parecido lo
    // hacia por casualidad, a traves de una SUCURSAL sin vendedor, y dejaba de
    // hacerlo en cuanto el sabotaje se limitaba a los clientes raiz.
    if (fx.clienteSinVendedor === null) {
      throw new Error(
        'No hay clientes raiz sin vendedor asignado. El camino sin matriz de ' +
          'assertSalespersonOwnsPartner queda SIN PROBAR.',
      );
    }

    // A y B, no solo uno: que el 403 no dependa de que el vendedor elegido tenga
    // o no cartera grande.
    for (const vendedor of [fx.vendedorA, fx.vendedorB]) {
      const r = await get(
        `/api/v1/salesperson/clients/${fx.clienteSinVendedor}/invoicing`,
        comoVendedor(vendedor),
      );
      expect(r.status).toBe(403);
      expect(r.body?.error?.code).toBe('PARTNER_NOT_IN_PORTFOLIO');
    }
  });

  it('las carteras de dos vendedores no se solapan', async () => {
    const [a, b] = await Promise.all([
      get('/api/v1/salesperson/portfolio', comoVendedor(fx.vendedorA)),
      get('/api/v1/salesperson/portfolio', comoVendedor(fx.vendedorB)),
    ]);
    const idsA = new Set((a.body as never as { data: { id: number }[] }).data.map((r) => r.id));
    const idsB = (b.body as never as { data: { id: number }[] }).data.map((r) => r.id);
    expect(idsB.filter((id) => idsA.has(id))).toEqual([]);
  });

  it('un vendedor no puede leer NINGÚN cliente de la cartera ajena (muestreo)', async () => {
    const b = await get('/api/v1/salesperson/portfolio', comoVendedor(fx.vendedorB));
    const muestra = (b.body as never as { data: { id: number }[] }).data.slice(0, 8);

    const resultados = await Promise.all(
      muestra.map((c) =>
        get(`/api/v1/salesperson/clients/${c.id}/invoicing`, comoVendedor(fx.vendedorA)),
      ),
    );
    // Ni un solo 200. Basta una fuga para que el gate falle.
    expect(resultados.map((r) => r.status)).toEqual(muestra.map(() => 403));
  });
});

describe('#25 · El endpoint de perfil pasa por la misma puerta', () => {
  // Cada endpoint nuevo hay que volver a probarlo. Que el de facturacion este
  // bien protegido no dice nada del siguiente: la autorizacion no se hereda,
  // se escribe, y por tanto se puede olvidar.

  it('el vendedor SÍ ve el perfil de su cliente', async () => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeA}/profile`,
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(200);
  });

  it('NO ve el perfil de un cliente ajeno', async () => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeB}/profile`,
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('PARTNER_NOT_IN_PORTFOLIO');
  });

  it('NO ve el perfil de una SUCURSAL ajena', async () => {
    if (fx.sucursalAjena === null) return;
    const r = await get(
      `/api/v1/salesperson/clients/${fx.sucursalAjena.id}/profile`,
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(403);
  });

  it('sin autenticación devuelve 401', async () => {
    const r = await get(`/api/v1/salesperson/clients/${fx.clienteDeA}/profile`);
    expect(r.status).toBe(401);
  });

  it.each(['BRONCE', 'GOLD'])('el rol %s no ve perfiles', async (rol) => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeA}/profile`,
      comoRol(fx.vendedorA, rol),
    );
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('el intento contra un perfil ajeno también queda auditado', async () => {
    const antes = auditados.filter((e) => e.action === 'access.denied.partner').length;
    await get(`/api/v1/salesperson/clients/${fx.clienteDeB}/profile`, comoVendedor(fx.vendedorA));
    const eventos = auditados.filter((e) => e.action === 'access.denied.partner');
    expect(eventos.length).toBe(antes + 1);
    expect(eventos[eventos.length - 1].targetId).toBe(String(fx.clienteDeB));
  });
});

describe('#25 · Roles', () => {
  it('SUPERADMIN puede ver cualquier cliente', async () => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeB}/invoicing`,
      comoRol(fx.vendedorA, 'SUPERADMIN'),
    );
    expect(r.status).toBe(200);
  });

  it.each(['BRONCE', 'PLATA', 'GOLD'])('el rol %s no entra en la cartera', async (rol) => {
    const r = await get('/api/v1/salesperson/portfolio', comoRol(fx.vendedorA, rol));
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('ROLE_NOT_ALLOWED');
  });

  it.each(['BRONCE', 'PLATA', 'GOLD'])('el rol %s no entra en una ficha', async (rol) => {
    const r = await get(
      `/api/v1/salesperson/clients/${fx.clienteDeA}/invoicing`,
      comoRol(fx.vendedorA, rol),
    );
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('ROLE_NOT_ALLOWED');
  });
});

describe('#25 · Entradas hostiles', () => {
  it('sin autenticación devuelve 401', async () => {
    const r = await get('/api/v1/salesperson/portfolio');
    expect(r.status).toBe(401);
  });

  it('un cliente inexistente devuelve 404, no 403', async () => {
    // La distinción importa: un 403 sobre un id que no existe confirmaría al
    // atacante que el id SÍ existe pero es de otro.
    const r = await get(
      '/api/v1/salesperson/clients/999999999/invoicing',
      comoVendedor(fx.vendedorA),
    );
    expect(r.status).toBe(404);
  });

  it.each([
    ['abc', 400],
    ['-5', 400],
    ['0', 400],
    ['1.5', 400],
  ])('el partnerId "%s" se rechaza con %i', async (id, esperado) => {
    const r = await get(`/api/v1/salesperson/clients/${id}/invoicing`, comoVendedor(fx.vendedorA));
    expect(r.status).toBe(esperado);
  });

  it('no se puede suplantar a otro vendedor por query string', async () => {
    // El odooUserId sale SIEMPRE de la identidad, nunca del request. Si algún
    // día alguien añade un parámetro de conveniencia, este test lo caza.
    const r = await get(
      `/api/v1/salesperson/portfolio?odooUserId=${fx.vendedorB}&userId=${fx.vendedorB}`,
      comoVendedor(fx.vendedorA),
    );
    const propio = await get('/api/v1/salesperson/portfolio', comoVendedor(fx.vendedorA));
    expect(r.status).toBe(200);
    expect((r.body as never as { meta: { clientes: number } }).meta.clientes).toBe(
      (propio.body as never as { meta: { clientes: number } }).meta.clientes,
    );
  });
});

describe('#25 · Rastro de auditoría', () => {
  it('cada acceso denegado a cartera ajena queda registrado', async () => {
    const antes = auditados.filter((e) => e.action === 'access.denied.partner').length;

    await get(`/api/v1/salesperson/clients/${fx.clienteDeB}/invoicing`, comoVendedor(fx.vendedorA));

    const eventos = auditados.filter((e) => e.action === 'access.denied.partner');
    expect(eventos.length).toBe(antes + 1);

    const ultimo = eventos[eventos.length - 1];
    expect(ultimo.actorOdooUserId).toBe(fx.vendedorA);
    expect(ultimo.targetId).toBe(String(fx.clienteDeB));
    expect(ultimo.targetType).toBe('res.partner');
  });

  it('el rechazo por rol también queda registrado', async () => {
    const antes = auditados.filter((e) => e.action === 'access.denied.role').length;
    await get('/api/v1/salesperson/portfolio', comoRol(fx.vendedorA, 'GOLD'));
    const eventos = auditados.filter((e) => e.action === 'access.denied.role');
    expect(eventos.length).toBe(antes + 1);
    expect(eventos[eventos.length - 1].metadata?.rol).toBe('GOLD');
  });

  it('un acceso legítimo NO genera evento de denegación', async () => {
    const antes = auditados.filter((e) => e.action.startsWith('access.denied')).length;
    await get(`/api/v1/salesperson/clients/${fx.clienteDeA}/invoicing`, comoVendedor(fx.vendedorA));
    const despues = auditados.filter((e) => e.action.startsWith('access.denied')).length;
    expect(despues).toBe(antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test de propiedad (issue #44, sección 2)
//
// El muestreo de más arriba coge los 8 PRIMEROS clientes de un vendedor. Eso
// prueba siempre los mismos ocho, así que un fallo de scoping que solo afecte a
// cierto tipo de cliente —una sucursal con la matriz en otra cartera, un partner
// sin `commercial_partner_id` propio— no se toparía nunca con él.
//
// Y hay una mitad que ningún test cubría: los 403 demuestran que se deniega lo
// ajeno, pero NO que lo permitido esté limpio. Una respuesta 200 que devolviera
// datos de otro cliente pasaría entera por la batería anterior.
//
// Esto ataca las dos: pares al azar, y verificación del CONTENIDO de lo que sí
// se autoriza.
// ─────────────────────────────────────────────────────────────────────────────

interface FilaCartera {
  id: number;
  nombre: string;
  totalFacturado: number;
  numeroFacturas: number;
}

/** Muestra al azar sin repetir. Devuelve menos de `n` si no hay suficientes. */
function alAzar<T>(origen: readonly T[], n: number): T[] {
  const copia = [...origen];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
}

describe('#44 · Propiedad: ninguna respuesta mezcla carteras', () => {
  const MUESTRA = 6;

  let carteraA: FilaCartera[];
  let carteraB: FilaCartera[];

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      get('/api/v1/salesperson/portfolio', comoVendedor(fx.vendedorA)),
      get('/api/v1/salesperson/portfolio', comoVendedor(fx.vendedorB)),
    ]);
    carteraA = (a.body as never as { data: FilaCartera[] }).data;
    carteraB = (b.body as never as { data: FilaCartera[] }).data;

    // Sin esto, una cartera vacía haría que los tests de abajo pasaran sin
    // probar nada. Ya pasó una vez en este fichero y costó caro.
    if (carteraA.length === 0 || carteraB.length === 0) {
      throw new Error(
        `Fixtures insuficientes: A tiene ${carteraA.length} clientes y B ${carteraB.length}. ` +
          'El test de propiedad necesita las dos carteras con contenido.',
      );
    }
  }, 120_000);

  it(`${MUESTRA} clientes AJENOS al azar: ninguno se filtra`, async () => {
    const muestra = alAzar(carteraB, MUESTRA);

    const resultados = await Promise.all(
      muestra.map(async (c) => {
        const [inv, perfil] = await Promise.all([
          get(`/api/v1/salesperson/clients/${c.id}/invoicing`, comoVendedor(fx.vendedorA)),
          get(`/api/v1/salesperson/clients/${c.id}/profile`, comoVendedor(fx.vendedorA)),
        ]);
        return { id: c.id, nombre: c.nombre, inv: inv.status, perfil: perfil.status };
      }),
    );

    // Se enseña el par concreto que falló: con muestreo al azar, un fallo que
    // solo dice "esperaba 403" no se puede reproducir a mano.
    const filtrados = resultados.filter((r) => r.inv !== 403 || r.perfil !== 403);
    expect(
      filtrados.map((r) => `${r.id} (${r.nombre}) → invoicing ${r.inv}, profile ${r.perfil}`),
    ).toEqual([]);
  }, 120_000);

  it(`${MUESTRA} clientes PROPIOS al azar: la respuesta es de quien se pidió`, async () => {
    const muestra = alAzar(carteraA, MUESTRA);

    const desajustes: string[] = [];

    for (const c of muestra) {
      const r = await get(
        `/api/v1/salesperson/clients/${c.id}/invoicing`,
        comoVendedor(fx.vendedorA),
      );
      if (r.status !== 200) {
        desajustes.push(`${c.id} (${c.nombre}) → HTTP ${r.status} en su PROPIO cliente`);
        continue;
      }

      const cuerpo = r.body as never as {
        data: { cliente: { id: number; nombre?: string }; facturacion: { totalFacturado: number } };
      };

      // Que devuelva el cliente que se pidió, y no otro. Una sustitución silenciosa
      // —por un índice mal calculado, por una caché mal indexada— saldría aquí y
      // por ningún otro sitio.
      if (cuerpo.data.cliente.id !== c.id) {
        desajustes.push(`se pidió ${c.id} y devolvió ${cuerpo.data.cliente.id}`);
      }
    }

    expect(desajustes).toEqual([]);
  }, 180_000);

  it('el total individual coincide con el de la cartera, cliente a cliente', async () => {
    /*
     * La propiedad más fuerte de las tres.
     *
     * La cartera calcula los totales EN LOTE, con un `read_group` sobre
     * `commercial_partner_id in [...]`. La ficha los calcula de uno en uno, con
     * `child_of`. Son dos caminos distintos hasta el mismo número.
     *
     * Si la consulta en lote agrupara mal —y metiera en la fila de un cliente
     * facturas que son de otro— los dos caminos dejarían de coincidir. Eso es
     * exactamente la forma que tendría una fuga entre clientes de la MISMA
     * cartera, que ningún 403 puede detectar porque los dos accesos son
     * legítimos.
     */
    const muestra = alAzar(
      carteraA.filter((c) => c.numeroFacturas > 0),
      MUESTRA,
    );

    if (muestra.length === 0) {
      throw new Error('Ningún cliente de A tiene facturas: el test no probaría nada.');
    }

    const desajustes: string[] = [];

    for (const c of muestra) {
      const r = await get(
        `/api/v1/salesperson/clients/${c.id}/invoicing`,
        comoVendedor(fx.vendedorA),
      );
      const total = (r.body as never as { data: { facturacion: { totalFacturado: number } } })
        .data.facturacion.totalFacturado;

      /*
       * Comprobar que son NÚMEROS antes de restarlos. No es paranoia: este test
       * leía `facturacion.total`, que no existe en el contrato —el campo se
       * llama `totalFacturado`—, así que la resta daba NaN, `NaN > 0.01` es
       * false, y el test pasaba sin comparar nada. Lo destapó sabotear el
       * servicio a propósito y ver que NADIE se quejaba.
       *
       * Cualquier comparación con tolerancia tiene esta trampa: el caso de
       * "no hay valor" se cuela por el mismo sitio que el de "los valores
       * coinciden".
       */
      if (!Number.isFinite(total) || !Number.isFinite(c.totalFacturado)) {
        desajustes.push(
          `${c.id} (${c.nombre}): no llegó un número — cartera ${c.totalFacturado} · ficha ${total}`,
        );
        continue;
      }

      // Un céntimo de tolerancia: son dos sumas de floats de Odoo por caminos
      // distintos, no dos lecturas del mismo número.
      if (Math.abs(total - c.totalFacturado) > 0.01) {
        desajustes.push(
          `${c.id} (${c.nombre}): cartera ${c.totalFacturado} · ficha ${total}`,
        );
      }
    }

    expect(desajustes).toEqual([]);
  }, 180_000);
});
