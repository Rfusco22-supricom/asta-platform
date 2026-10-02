import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../config/dotenv.js';

/**
 * #53 · «Olvidé mi contraseña», contra MySQL de verdad y con un SMTP de mentira
 * que guarda lo que se envía.
 *
 * Usuarios inventados con correo `@reseteo.local`. Lo que se vigila:
 *
 *   · la respuesta no dice si la cuenta existe;
 *   · el token viaja en el correo y en la base solo está su hash;
 *   · caduca en una hora, sirve una vez y pedir otro invalida el anterior;
 *   · al usarlo se cierran las sesiones y se desbloquea la cuenta;
 *   · un buzón no recibe más de tres correos por hora;
 *   · ni el token ni la contraseña acaban en la auditoría.
 */

process.env.JWT_SECRET = 'clave-de-pruebas-con-mas-de-treinta-y-dos-caracteres';
process.env.ARGON2_MEMORY_KIB = '8192';
process.env.ARGON2_ITERATIONS = '1';
delete process.env.SMTP_HOST;

const { resetAuthEnvCache } = await import('../config/authEnv.js');
const { resetCorreoEnvCache } = await import('../config/correoEnv.js');
const { prisma } = await import('../config/prisma.js');
const { hashSecreto, emitirSecreto, caducaEnDias } = await import('../auth/tokens.js');
const { hashPassword, verifyPassword } = await import('../auth/password.js');
const { usarTransporteDePrueba } = await import('../services/correo.service.js');
const { registerAuditSink } = await import('../services/audit.service.js');
const { solicitarReseteo, validarReseteo, restablecerContrasena, ReseteoInvalido, RESETEOS_POR_HORA } = await import(
  '../services/reseteo.service.js'
);
const { ContrasenaDebil } = await import('../services/invitation.service.js');
const { createApp } = await import('../server.js');
const { emitirAccessToken } = await import('../auth/jwt.js');

const DOMINIO = 'reseteo.local';
const BASE = 'https://panel.example';
const CLAVE_NUEVA = 'una frase larga que recuerdo bien 42';

const enviados: Array<{ to: string; subject: string; text: string; html: string }> = [];
const eventos: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
let comprobado = false;

async function crear(local: string, extra: { isActive?: boolean; odooUserId?: number | null; clave?: string } = {}) {
  const u = await prisma.appUser.create({
    data: {
      email: `${local}@${DOMINIO}`,
      fullName: `Persona ${local}`,
      role: extra.odooUserId ? 'VENDEDOR' : 'BRONCE',
      odooPartnerId: 3_900_000_000 + Math.floor(Math.random() * 90_000_000),
      odooUserId: extra.odooUserId ?? null,
      isActive: extra.isActive ?? true,
    },
  });
  if (extra.clave) await prisma.userCredential.create({ data: { userId: u.id, passwordHash: await hashPassword(extra.clave) } });
  return u;
}

/** El token sale del enlace del correo, como lo usaría la persona. */
const tokenDelCorreo = (texto: string) => texto.match(/\/restablecer\/([A-Za-z0-9_-]+)/)?.[1] ?? '';

async function limpiar() {
  const ids = (await prisma.appUser.findMany({ where: { email: { endsWith: `@${DOMINIO}` } }, select: { id: true } })).map((u) => u.id);
  await prisma.authToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.staffLoginGuard.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userCredential.deleteMany({ where: { userId: { in: ids } } });
  await prisma.appUser.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  resetAuthEnvCache();
  resetCorreoEnvCache();
  if (await prisma.appUser.count({ where: { email: { endsWith: `@${DOMINIO}` } } })) throw new Error(`Restos @${DOMINIO}: límpialos a mano.`);
  comprobado = true;
  registerAuditSink((e) => eventos.push(e));
});

beforeEach(async () => {
  if (comprobado) await limpiar();
  enviados.length = 0;
  eventos.length = 0;
  usarTransporteDePrueba({ sendMail: async (m) => void enviados.push(m) });
});

afterAll(async () => {
  usarTransporteDePrueba(null);
  if (comprobado) await limpiar();
  await prisma.$disconnect();
});

describe('#53 · Pedir el enlace', () => {
  it('con cuenta: un correo con el enlace, y en la base solo el hash del token', async () => {
    const u = await crear('ana');
    expect(await solicitarReseteo(`ana@${DOMINIO}`, BASE)).toBe('enviado');

    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(`ana@${DOMINIO}`);
    expect(enviados[0].text).toContain(`${BASE}/restablecer/`);
    const token = tokenDelCorreo(enviados[0].text);
    expect(token.length).toBeGreaterThan(20);

    const filas = await prisma.authToken.findMany({ where: { userId: u.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ purpose: 'PASSWORD_RESET', tokenHash: hashSecreto(token), usedAt: null });
    expect(filas[0].tokenHash).not.toBe(token);
    const minutos = (filas[0].expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(55);
    expect(minutos).toBeLessThanOrEqual(60);
  });

  it('el correo se busca normalizado: mayúsculas y espacios dan igual', async () => {
    await crear('beto');
    expect(await solicitarReseteo(`  BETO@${DOMINIO.toUpperCase()} `, BASE)).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });

  it('sin cuenta, o con la cuenta desactivada: ni correo ni token', async () => {
    await crear('baja', { isActive: false });
    expect(await solicitarReseteo(`nadie@${DOMINIO}`, BASE)).toBe('sin_cuenta');
    expect(await solicitarReseteo(`baja@${DOMINIO}`, BASE)).toBe('inactiva');
    expect(enviados).toHaveLength(0);
    expect(await prisma.authToken.count({ where: { user: { email: { endsWith: `@${DOMINIO}` } } } })).toBe(0);
  });

  it('pedir otro invalida el anterior: un enlace viejo que alguien vio ya no sirve', async () => {
    await crear('caro');
    await solicitarReseteo(`caro@${DOMINIO}`, BASE);
    await solicitarReseteo(`caro@${DOMINIO}`, BASE);
    const [viejo, nuevo] = enviados.map((m) => tokenDelCorreo(m.text));

    await expect(validarReseteo(viejo)).rejects.toBeInstanceOf(ReseteoInvalido);
    await expect(validarReseteo(nuevo)).resolves.toMatchObject({ email: `caro@${DOMINIO}` });
  });

  it(`un buzón no recibe más de ${RESETEOS_POR_HORA} por hora: el formulario no sirve para hacer spam`, async () => {
    await crear('dani');
    for (let i = 0; i < RESETEOS_POR_HORA; i++) expect(await solicitarReseteo(`dani@${DOMINIO}`, BASE)).toBe('enviado');
    expect(await solicitarReseteo(`dani@${DOMINIO}`, BASE)).toBe('limite');
    expect(enviados).toHaveLength(RESETEOS_POR_HORA);
  });

  it('sin SMTP: se crea el token pero no se envía nada, y no es un error', async () => {
    usarTransporteDePrueba(null);
    await crear('eva');
    expect(await solicitarReseteo(`eva@${DOMINIO}`, BASE)).toBe('sin_smtp');
    expect(enviados).toHaveLength(0);
  });

  it('al personal se le recuerda que puede entrar con Odoo; a un cliente, no', async () => {
    await crear('vend', { odooUserId: 3_990_000_001 });
    await crear('cli');
    await solicitarReseteo(`vend@${DOMINIO}`, BASE);
    await solicitarReseteo(`cli@${DOMINIO}`, BASE);
    expect(enviados[0].text).toContain('Odoo');
    expect(enviados[1].text).not.toContain('Odoo');
  });

  it('el nombre va escapado en el HTML', async () => {
    const u = await crear('html');
    await prisma.appUser.update({ where: { id: u.id }, data: { fullName: '<script>x</script>' } });
    await solicitarReseteo(`html@${DOMINIO}`, BASE);
    expect(enviados[0].html).not.toContain('<script>');
    expect(enviados[0].html).toContain('&lt;script&gt;');
  });
});

describe('#53 · Usar el enlace', () => {
  async function enlacePara(local: string, extra: Parameters<typeof crear>[1] = {}) {
    const u = await crear(local, extra);
    await solicitarReseteo(`${local}@${DOMINIO}`, BASE);
    return { u, token: tokenDelCorreo(enviados.at(-1)!.text) };
  }

  it('fija la contraseña nueva, gasta el token y cierra todas las sesiones', async () => {
    const { u, token } = await enlacePara('fran', { clave: 'la vieja que se me olvido 1' });
    await prisma.userSession.create({
      data: { userId: u.id, refreshTokenHash: emitirSecreto().hash, expiresAt: caducaEnDias(30) },
    });

    await restablecerContrasena(token, CLAVE_NUEVA);

    const cred = await prisma.userCredential.findUniqueOrThrow({ where: { userId: u.id } });
    expect(await verifyPassword(cred.passwordHash, CLAVE_NUEVA)).toBe(true);
    expect(await prisma.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect((await prisma.authToken.findFirstOrThrow({ where: { userId: u.id } })).usedAt).not.toBeNull();
  });

  it('solo sirve una vez', async () => {
    const { token } = await enlacePara('gabi');
    await restablecerContrasena(token, CLAVE_NUEVA);
    await expect(restablecerContrasena(token, 'otra frase larga distinta 77')).rejects.toBeInstanceOf(ReseteoInvalido);
  });

  it('caducado no sirve', async () => {
    const { u, token } = await enlacePara('hugo');
    await prisma.authToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(validarReseteo(token)).rejects.toBeInstanceOf(ReseteoInvalido);
  });

  it('desbloquea la cuenta: quien se bloqueó probando acaba de demostrar que tiene el correo', async () => {
    const { u, token } = await enlacePara('ines', { clave: 'la vieja que se me olvido 2', odooUserId: 3_990_000_002 });
    const enUnRato = new Date(Date.now() + 15 * 60_000);
    await prisma.userCredential.update({ where: { userId: u.id }, data: { failedAttempts: 8, lockedUntil: enUnRato } });
    await prisma.staffLoginGuard.create({ data: { userId: u.id, failedAttempts: 8, lockedUntil: enUnRato } });

    await restablecerContrasena(token, CLAVE_NUEVA);

    expect(await prisma.userCredential.findUniqueOrThrow({ where: { userId: u.id } })).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    expect(await prisma.staffLoginGuard.findUniqueOrThrow({ where: { userId: u.id } })).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('una contraseña débil se rechaza y el enlace sigue valiendo', async () => {
    const { token } = await enlacePara('juan');
    await expect(restablecerContrasena(token, 'corta')).rejects.toBeInstanceOf(ContrasenaDebil);
    await expect(validarReseteo(token)).resolves.toBeTruthy();
  });

  it('un enlace de INVITACIÓN no sirve para restablecer', async () => {
    const u = await crear('kike');
    const s = emitirSecreto();
    await prisma.authToken.create({ data: { userId: u.id, purpose: 'INVITE', tokenHash: s.hash, expiresAt: caducaEnDias(7) } });
    await expect(validarReseteo(s.plaintext)).rejects.toBeInstanceOf(ReseteoInvalido);
  });

  it('ni el token ni la contraseña acaban en la auditoría', async () => {
    const { token } = await enlacePara('luis');
    await restablecerContrasena(token, CLAVE_NUEVA);
    const todo = JSON.stringify(eventos);
    expect(eventos.map((e) => e.action)).toEqual(expect.arrayContaining(['auth.reseteo_solicitado', 'auth.contrasena_restablecida']));
    expect(todo).not.toContain(token);
    expect(todo).not.toContain(CLAVE_NUEVA);
  });
});

describe('#53 · La ruta', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const dir = server.address();
    base = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const pedir = (email: string) =>
    fetch(`${base}/api/v1/auth/forgot-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });

  it('contesta exactamente lo mismo exista o no la cuenta', async () => {
    await crear('mara');
    const [conCuenta, sinCuenta] = await Promise.all([pedir(`mara@${DOMINIO}`), pedir(`nadie@${DOMINIO}`)]);

    expect(conCuenta.status).toBe(200);
    expect(sinCuenta.status).toBe(200);
    expect(await conCuenta.text()).toBe(await sinCuenta.text());

    // La ruta contesta ANTES de enviar el correo, a propósito (así el tiempo de
    // respuesta tampoco dice si la cuenta existe). Hay que esperar a que salga:
    // sin esto, el correo de mara llegaba DESPUÉS de que el `beforeEach` del
    // test siguiente vaciara `enviados`, y ese test contaba dos correos en vez
    // de uno. Fallaba solo en la suite completa, cuando la máquina va cargada.
    await vi.waitFor(() => expect(enviados).toHaveLength(1), { timeout: 10_000, interval: 50 });
    expect(enviados[0].to).toBe(`mara@${DOMINIO}`);
  });

  /** Un SUPERADMIN con sesión, para la ruta de invitar. */
  async function tokenDeAdmin() {
    const u = await prisma.appUser.create({
      data: { email: `admin@${DOMINIO}`, fullName: 'Admin', role: 'SUPERADMIN', odooPartnerId: 3_990_000_100, isActive: true },
    });
    const sesion = await prisma.userSession.create({
      data: { userId: u.id, refreshTokenHash: emitirSecreto().hash, expiresAt: caducaEnDias(1) },
      select: { id: true },
    });
    return emitirAccessToken({ sub: u.id, role: 'SUPERADMIN', odooPartnerId: u.odooPartnerId, odooUserId: null, sid: sesion.id });
  }

  const invitar = (token: string, userId: string) =>
    fetch(`${base}/api/v1/admin/users/${userId}/invite`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

  it('con SMTP, la invitación sale por correo y la respuesta lo dice', async () => {
    const admin = await tokenDeAdmin();
    const invitado = await crear('nuevo');
    const r = await invitar(admin, invitado.id);
    const body = (await r.json()) as { data: { url: string; enviadoPorCorreo: boolean } };

    expect(r.status).toBe(200);
    expect(body.data.enviadoPorCorreo).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(`nuevo@${DOMINIO}`);
    // El mismo enlace que se devuelve al administrador, por si el correo no llega.
    expect(enviados[0].text).toContain(body.data.url);
  });

  it('sin SMTP, no sale nada y la respuesta no finge que salió', async () => {
    usarTransporteDePrueba(null);
    const admin = await tokenDeAdmin();
    const invitado = await crear('otro');
    const body = (await (await invitar(admin, invitado.id)).json()) as { data: { enviadoPorCorreo: boolean }; meta: { entrega: string } };

    expect(body.data.enviadoPorCorreo).toBe(false);
    expect(body.meta.entrega).toBe('manual');
    expect(enviados).toHaveLength(0);
  });

  it('un enlace inventado da el mismo error que uno caducado', async () => {
    const r = await fetch(`${base}/api/v1/auth/reset-password/inventado123`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe(new ReseteoInvalido('caducado').message);
  });
});
