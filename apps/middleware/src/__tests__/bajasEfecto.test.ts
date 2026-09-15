import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { login, LoginFallido } from '../services/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { issueApiKey, verifyApiKey } from '../services/apiKey.service.js';

/**
 * Issue #89 — que desactivar SIRVA de algo.
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 *
 * Todo el valor de #89 descansa en una premisa que no comprobaba nadie: que
 * poner `isActive = false` cierra de verdad las puertas. Se lee en seis sitios,
 * y no había un solo test de que alguna de ellas lo respetara.
 *
 * Es la clase de cosa que se da por supuesta porque el `if` se ve ahí, en el
 * código. Pero #89 existe justo porque durante meses la palanca estaba puesta en
 * los seis sitios y **no la accionaba nadie** — dar por supuesto el otro extremo
 * de esa misma cadena sería repetir el error.
 *
 * No repite la matriz entera: comprueba las dos puertas por las que se entra de
 * verdad, el login del panel y una API key.
 */

let userId = '';
const EMAIL = 'test.baja.efecto@asta.local';
const CLAVE = 'PruebaBajas-89!';

beforeAll(async () => {
  const hash = await hashPassword(CLAVE);
  const u = await prisma.appUser.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL,
      fullName: 'Efecto de la baja (#89)',
      role: 'BRONCE',
      odooPartnerId: 992_000_089,
      isActive: true,
    },
    update: { isActive: true },
  });
  userId = u.id;

  await prisma.userCredential.upsert({
    where: { userId },
    create: { userId, passwordHash: hash, passwordChangedAt: new Date() },
    update: { passwordHash: hash, failedAttempts: 0, lockedUntil: null },
  });
});

afterAll(async () => {
  if (userId) {
    await prisma.apiKey.deleteMany({ where: { userId } });
    await prisma.appUser.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

const activar = (isActive: boolean) => prisma.appUser.update({ where: { id: userId }, data: { isActive } });

describe('#89 · desactivar cierra las puertas', () => {
  it('con la cuenta activa se entra', async () => {
    // Primero el control: sin esto, el test de abajo pasaría igual si la
    // contraseña estuviera mal puesta, y no probaría nada sobre `isActive`.
    await activar(true);
    const s = await login(EMAIL, CLAVE);
    expect(s.accessToken).toBeTruthy();
  });

  it('desactivada, el login la rechaza', async () => {
    await activar(false);
    await expect(login(EMAIL, CLAVE)).rejects.toBeInstanceOf(LoginFallido);
  });

  it('el mensaje no dice que la cuenta esté desactivada', async () => {
    /*
     * Que una cuenta exista pero esté apagada tampoco es asunto de quien no
     * puede demostrar que es suya. Distinguirlo convierte el formulario en un
     * verificador de qué correos tienen cuenta en la empresa.
     */
    await activar(false);
    const fallo: unknown = await login(EMAIL, CLAVE).catch((e: unknown) => e);
    expect(fallo).toBeInstanceOf(LoginFallido);

    const mensaje = (fallo as LoginFallido).message.toLowerCase();
    expect(mensaje).not.toContain('desactiv');
    expect(mensaje).not.toContain('inactiv');
  });

  it('desactivada, sus API keys dejan de valer', async () => {
    // Es la otra puerta, y la que más fácil se olvida: una integración con una
    // key válida seguiría leyendo facturas aunque la persona ya no entre.
    await activar(true);
    const k = await issueApiKey({ userId, name: 'baja #89', scopes: ['INVOICES_READ'] });

    const antes = await verifyApiKey(k.plaintext);
    expect(antes.ok).toBe(true);

    await activar(false);

    const despues = await verifyApiKey(k.plaintext);
    expect(despues.ok).toBe(false);
    if (!despues.ok) expect(despues.reason).toBe('USER_INACTIVE');
  });
});
