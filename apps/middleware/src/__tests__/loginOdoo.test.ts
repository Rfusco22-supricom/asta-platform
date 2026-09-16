import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #85 · El personal entra con su contraseña de Odoo, o con la del panel como respaldo.
 *
 * Odoo va simulado —el caso de interés es el que no se puede provocar contra la
 * instancia real: que caiga, que la persona esté de baja, que tenga la
 * verificación en dos pasos— y MySQL es el real, con usuarios `@loginodoo.local`
 * y ids de Odoo que no existen.
 *
 * Lo que se vigila por encima de todo:
 *
 *   · el bloqueo corta ANTES de llegar a Odoo
 *   · la contraseña de Odoo no aparece en la auditoría
 *   · el respaldo no deja entrar a quien Odoo tiene de baja
 *   · un cliente nunca pasa por Odoo
 *   · LOGIN_ODOO=false apaga el camino entero
 */

const odoo = vi.hoisted(() => ({
  usuarios: new Map<number, { login: string; active: boolean; totp_enabled?: boolean; password: string; uidQueDevuelve?: number }>(),
  caido: false,
  autenticar: vi.fn(),
  leer: vi.fn(),
}));

vi.mock('../odoo/client.js', async (original) => {
  const real = await original<typeof import('../odoo/client.js')>();
  return {
    ...real,
    searchRead: odoo.leer.mockImplementation(async (modelo: string, dominio: Array<[string, string, unknown]>, campos: string[]) => {
      if (odoo.caido) throw new Error('Odoo caído (simulado)');
      if (modelo !== 'res.users') throw new Error(`consulta inesperada a ${modelo}`);
      const [campo, , valor] = dominio[0];
      const filas = [...odoo.usuarios.entries()].filter(([id, u]) => (campo === 'id' ? id === valor : u.login.toLowerCase() === String(valor).toLowerCase()));
      return filas.map(([id, u]) => Object.fromEntries([['id', id], ...campos.filter((c) => c !== 'id').map((c) => [c, (u as Record<string, unknown>)[c]])]));
    }),
    autenticarEnOdoo: odoo.autenticar.mockImplementation(async (login: string, password: string) => {
      if (odoo.caido) throw new real.OdooNoDisponible();
      const fila = [...odoo.usuarios.entries()].find(([, u]) => u.login === login);
      if (!fila) return false;
      const [id, u] = fila;
      return u.active && !u.totp_enabled && u.password === password ? (u.uidQueDevuelve ?? id) : false;
    }),
  };
});

const { resetAuthEnvCache } = await import('../config/authEnv.js');
const { prisma } = await import('../config/prisma.js');
const { hashPassword } = await import('../auth/password.js');
const { login, LoginFallido } = await import('../services/auth.service.js');
const { registerAuditSink } = await import('../services/audit.service.js');

const UID = { vendedor: 4_100_000_001, admin: 4_100_000_002, baja: 4_100_000_003, dosPasos: 4_100_000_004, reasignado: 4_100_000_005 };
const CLAVE_ODOO = 'la-de-odoo-9f2c';
const CLAVE_PANEL = 'la-del-panel-7b1e';
const eventos: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
let comprobado = false;

async function falla(promesa: Promise<unknown>): Promise<InstanceType<typeof LoginFallido>> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof LoginFallido) return e;
    throw e;
  }
  throw new Error('El login debía fallar y entró');
}

async function crear(email: string, role: 'VENDEDOR' | 'SUPERADMIN' | 'BRONCE', odooUserId: number | null, clavePanel?: string) {
  const u = await prisma.appUser.create({
    data: { email, fullName: email, role, odooPartnerId: 4_100_000_000 + Math.floor(Math.random() * 90_000_000), odooUserId, isActive: true },
  });
  if (clavePanel) await prisma.userCredential.create({ data: { userId: u.id, passwordHash: await hashPassword(clavePanel) } });
  return u;
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'clave-de-pruebas-con-mas-de-treinta-y-dos-caracteres';
  process.env.ARGON2_MEMORY_KIB = '8192';
  process.env.ARGON2_ITERATIONS = '1';
  process.env.LOGIN_MAX_ATTEMPTS = '3';
  delete process.env.LOGIN_ODOO;
  resetAuthEnvCache();

  if (await prisma.appUser.count({ where: { email: { endsWith: 'loginodoo.local' } } })) {
    throw new Error('Restos de *loginodoo.local en la base: límpialos a mano.');
  }
  comprobado = true;
  registerAuditSink((e) => eventos.push(e));

  odoo.usuarios.set(UID.vendedor, { login: 'ventas99@odoo.loginodoo.local', active: true, password: CLAVE_ODOO });
  odoo.usuarios.set(UID.admin, { login: 'admin@loginodoo.local', active: true, password: CLAVE_ODOO });
  odoo.usuarios.set(UID.baja, { login: 'baja@loginodoo.local', active: false, password: CLAVE_ODOO });
  odoo.usuarios.set(UID.dosPasos, { login: 'totp@loginodoo.local', active: true, totp_enabled: true, password: CLAVE_ODOO });
  // Su login autentica a OTRO usuario de Odoo (login reasignado entre la lectura y el authenticate).
  odoo.usuarios.set(UID.reasignado, { login: 'reasignado@loginodoo.local', active: true, password: CLAVE_ODOO, uidQueDevuelve: UID.admin });

  // El vendedor tiene en el panel un correo DISTINTO de su login de Odoo.
  await crear('ventas99@panel.loginodoo.local', 'VENDEDOR', UID.vendedor);
  await crear('admin@loginodoo.local', 'SUPERADMIN', UID.admin, CLAVE_PANEL);
  await crear('baja@loginodoo.local', 'VENDEDOR', UID.baja, CLAVE_PANEL);
  await crear('totp@loginodoo.local', 'VENDEDOR', UID.dosPasos);
  await crear('reasignado@loginodoo.local', 'VENDEDOR', UID.reasignado);
  await crear('cliente@loginodoo.local', 'BRONCE', null, CLAVE_PANEL);
}, 60_000);

beforeEach(() => {
  odoo.caido = false;
  odoo.autenticar.mockClear();
  odoo.leer.mockClear();
  eventos.length = 0;
});

afterAll(async () => {
  if (comprobado) {
    const ids = (await prisma.appUser.findMany({ where: { email: { endsWith: 'loginodoo.local' } }, select: { id: true } })).map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { endsWith: 'loginodoo.local' } }] } });
    await prisma.appUser.deleteMany({ where: { id: { in: ids } } });
  }
  delete process.env.LOGIN_MAX_ATTEMPTS;
  resetAuthEnvCache();
  await prisma.$disconnect();
});

describe('#85 · Con la contraseña de Odoo', () => {
  it('un vendedor entra con su contraseña de Odoo, sin tener contraseña del panel', async () => {
    const s = await login('ventas99@panel.loginodoo.local', CLAVE_ODOO);
    expect(s.usuario.role).toBe('VENDEDOR');
    expect(s.usuario.debeCambiarContrasena).toBe(false);
    expect(odoo.autenticar).toHaveBeenCalledWith('ventas99@odoo.loginodoo.local', CLAVE_ODOO);
  });

  it('también tecleando su LOGIN de Odoo, aunque no sea el correo del panel', async () => {
    const s = await login('VENTAS99@odoo.loginodoo.local', CLAVE_ODOO);
    expect(s.usuario.email).toBe('ventas99@panel.loginodoo.local');
  });

  it('contraseña de Odoo equivocada: mensaje genérico', async () => {
    const e = await falla(login('ventas99@panel.loginodoo.local', 'otra'));
    expect(e.message).toBe('Correo o contraseña incorrectos.');
  });

  it('la contraseña NO aparece en la auditoría', async () => {
    await falla(login('ventas99@panel.loginodoo.local', 'secreto-que-no-debe-salir'));
    expect(JSON.stringify(eventos)).not.toContain('secreto-que-no-debe-salir');
    expect(eventos.at(-1)?.metadata).toMatchObject({ motivo: 'contrasena_incorrecta', camino: 'personal' });
  });

  it('si Odoo autentica a OTRA persona (uid distinto del de la cuenta), no entra', async () => {
    await falla(login('reasignado@loginodoo.local', CLAVE_ODOO));
    expect(odoo.autenticar).toHaveBeenCalled();
  });

  it('con verificación en dos pasos en Odoo, al usuario no se le dice; en la auditoría, sí', async () => {
    const e = await falla(login('totp@loginodoo.local', CLAVE_ODOO));
    expect(e.message).toBe('Correo o contraseña incorrectos.');
    expect(eventos.at(-1)?.metadata).toMatchObject({ dosPasosEnOdoo: true });
  });
});

describe('#85 · Con la contraseña del panel, como respaldo', () => {
  it('el administrador entra con la del panel, sin preguntar la contraseña a Odoo', async () => {
    const s = await login('admin@loginodoo.local', CLAVE_PANEL);
    expect(s.usuario.role).toBe('SUPERADMIN');
    expect(odoo.autenticar).not.toHaveBeenCalled();
  });

  it('y también con la de Odoo', async () => {
    expect((await login('admin@loginodoo.local', CLAVE_ODOO)).usuario.role).toBe('SUPERADMIN');
  });

  it('con Odoo CAÍDO, la del panel sigue sirviendo', async () => {
    odoo.caido = true;
    expect((await login('admin@loginodoo.local', CLAVE_PANEL)).usuario.role).toBe('SUPERADMIN');
  });

  it('pero si Odoo responde que la persona está DE BAJA, la del panel no la deja entrar', async () => {
    await falla(login('baja@loginodoo.local', CLAVE_PANEL));
    expect(eventos.at(-1)?.metadata).toMatchObject({ motivo: 'baja_en_odoo' });
  });

  it('Odoo caído y sin contraseña del panel: lo dice, en vez de «contraseña incorrecta»', async () => {
    odoo.caido = true;
    const e = await falla(login('ventas99@panel.loginodoo.local', CLAVE_ODOO));
    expect(e.motivo).toBe('ODOO_NO_DISPONIBLE');
    expect(e.message).toMatch(/Odoo/);
  });
});

describe('#85 · Bloqueo', () => {
  it('tras los intentos, bloquea, y el bloqueo corta ANTES de llegar a Odoo', async () => {
    const email = 'totp@loginodoo.local';
    for (let i = 0; i < 3; i++) await falla(login(email, `mala-${i}`));
    odoo.autenticar.mockClear();

    const e = await falla(login(email, CLAVE_ODOO));
    expect(e.motivo).toBe('BLOQUEADA');
    expect(odoo.autenticar).not.toHaveBeenCalled();
  });

  it('un login bueno pone el contador a cero', async () => {
    const email = 'ventas99@panel.loginodoo.local';
    // Los tests de arriba ya le sumaron fallos: se parte de cero.
    await prisma.staffLoginGuard.deleteMany({ where: { user: { email } } });
    await falla(login(email, 'mala'));
    await falla(login(email, 'mala'));
    await login(email, CLAVE_ODOO);
    await falla(login(email, 'mala'));
    const u = await prisma.appUser.findUniqueOrThrow({ where: { email }, include: { staffLoginGuard: true } });
    expect(u.staffLoginGuard?.failedAttempts).toBe(1);
  });
});

describe('#85 · Lo que no cambia', () => {
  it('un cliente nunca pasa por Odoo: solo la contraseña del panel', async () => {
    await login('cliente@loginodoo.local', CLAVE_PANEL);
    await falla(login('cliente@loginodoo.local', CLAVE_ODOO));
    expect(odoo.autenticar).not.toHaveBeenCalled();
    // Ni siquiera se consulta Odoo: su correo es suyo y no hay usuario de Odoo que mirar.
    expect(odoo.leer).not.toHaveBeenCalled();
  });

  it('LOGIN_ODOO=false apaga el camino: la de Odoo deja de servir, la del panel no', async () => {
    process.env.LOGIN_ODOO = 'false';
    resetAuthEnvCache();
    try {
      await falla(login('ventas99@panel.loginodoo.local', CLAVE_ODOO));
      await falla(login('ventas99@odoo.loginodoo.local', CLAVE_ODOO));
      expect(odoo.autenticar).not.toHaveBeenCalled();
      expect((await login('admin@loginodoo.local', CLAVE_PANEL)).usuario.role).toBe('SUPERADMIN');
    } finally {
      delete process.env.LOGIN_ODOO;
      resetAuthEnvCache();
    }
  });
});
