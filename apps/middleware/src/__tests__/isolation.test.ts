import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';

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
}

let fx: Fixtures;

// ─────────────────────────────────────────────────────────────────────────────

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as { error?: { code?: string } } | null };
}

const comoVendedor = (uid: number) => ({ 'X-Dev-Odoo-User-Id': String(uid) });
const comoRol = (uid: number, rol: string) => ({
  'X-Dev-Odoo-User-Id': String(uid),
  'X-Dev-Role': rol,
});

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

  return {
    vendedorA: A.user_id[0],
    vendedorB: B.user_id[0],
    nombreA: A.user_id[1],
    nombreB: B.user_id[1],
    clienteDeA: await traerCliente(A.user_id[0]),
    clienteDeB: await traerCliente(B.user_id[0]),
    sucursalAjena,
    sucursalHeredada: heredada,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.DEV_AUTH_ENABLED = 'true';
  quitarSink = registerAuditSink((e) => auditados.push(e));

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const dir = server.address();
  if (!dir || typeof dir === 'string') throw new Error('no se pudo abrir el puerto');
  base = `http://127.0.0.1:${dir.port}`;

  fx = await descubrirFixtures();
}, 180_000);

afterAll(async () => {
  quitarSink?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
