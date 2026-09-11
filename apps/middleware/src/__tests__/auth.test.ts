import { beforeAll, describe, expect, it } from 'vitest';
import { resetAuthEnvCache } from '../config/authEnv.js';
import {
  evaluarFortaleza,
  hashPassword,
  necesitaRehash,
  verifyPassword,
  LONGITUD_MINIMA,
} from '../auth/password.js';
import {
  caducaEnDias,
  caducaEnMinutos,
  compararHash,
  emitirSecreto,
  haCaducado,
  hashSecreto,
} from '../auth/tokens.js';
import { bearerDe, emitirAccessToken, TokenInvalido, verificarAccessToken } from '../auth/jwt.js';

/**
 * Issues #51 y #52 — la capa criptográfica de la autenticación.
 *
 * Estos tests NO necesitan base de datos, que es justo lo que permite tenerlos
 * hoy: MySQL todavía no es alcanzable. La parte que sí la necesita (login
 * completo, rotación de sesiones) queda pendiente de #12.
 *
 * Que se puedan escribir sin base no es casualidad: el hashing, la firma y la
 * generación de secretos son funciones puras. Si hubiera que levantar Postgres
 * para probar que una contraseña se verifica, el diseño estaría mal.
 */

beforeAll(() => {
  process.env.JWT_SECRET = 'clave-de-pruebas-con-mas-de-treinta-y-dos-caracteres';
  // Coste bajo SOLO en tests: con los parámetros reales, 40 hashes serían ~3 s.
  process.env.ARGON2_MEMORY_KIB = '8192';
  process.env.ARGON2_ITERATIONS = '1';
  resetAuthEnvCache();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#51 · Hash de contraseñas', () => {
  it('produce un hash en formato PHC de argon2id', async () => {
    const h = await hashPassword('una-contrasena-larga');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
  });

  it('verifica la contraseña correcta', async () => {
    const h = await hashPassword('la-buena-de-verdad');
    expect(await verifyPassword(h, 'la-buena-de-verdad')).toBe(true);
  });

  it('rechaza la incorrecta', async () => {
    const h = await hashPassword('la-buena-de-verdad');
    expect(await verifyPassword(h, 'la-buena-de-verdas')).toBe(false);
    expect(await verifyPassword(h, '')).toBe(false);
  });

  it('dos hashes de la MISMA contraseña son distintos', async () => {
    // La sal es aleatoria por hash. Si coincidieran, un atacante sabría qué
    // cuentas comparten contraseña con solo mirar la tabla.
    const [a, b] = await Promise.all([hashPassword('identica'), hashPassword('identica')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'identica')).toBe(true);
    expect(await verifyPassword(b, 'identica')).toBe(true);
  });

  it('un hash corrupto devuelve false en vez de lanzar', async () => {
    // Desde fuera, "no coincide" y "el registro está roto" deben ser
    // indistinguibles: un 500 en vez de un 401 delata que la cuenta existe.
    expect(await verifyPassword('esto-no-es-un-hash', 'loquesea')).toBe(false);
    expect(await verifyPassword('$argon2id$roto', 'loquesea')).toBe(false);
    expect(await verifyPassword('', 'loquesea')).toBe(false);
  });

  it('acepta contraseñas con unicode y espacios', async () => {
    const clave = 'contraseña con ñ, tildes áéí y 👍 emoji';
    const h = await hashPassword(clave);
    expect(await verifyPassword(h, clave)).toBe(true);
  });
});

describe('#51 · Rehash al subir el coste', () => {
  it('detecta un hash creado con parámetros más débiles', async () => {
    const debil = await hashPassword('cualquiera');
    expect(necesitaRehash(debil)).toBe(false);

    // Se sube el coste: el hash antiguo pasa a estar por debajo.
    process.env.ARGON2_MEMORY_KIB = '65536';
    resetAuthEnvCache();
    expect(necesitaRehash(debil)).toBe(true);

    process.env.ARGON2_MEMORY_KIB = '8192';
    resetAuthEnvCache();
  });

  it('un formato desconocido siempre se rehashea', () => {
    expect(necesitaRehash('$2b$10$loquesea')).toBe(true); // bcrypt antiguo
    expect(necesitaRehash('sha256:deadbeef')).toBe(true);
    expect(necesitaRehash('')).toBe(true);
  });
});

describe('#51 · Fortaleza', () => {
  it(`exige al menos ${LONGITUD_MINIMA} caracteres`, () => {
    expect(evaluarFortaleza('corta').ok).toBe(false);
    expect(evaluarFortaleza('a'.repeat(LONGITUD_MINIMA - 1)).ok).toBe(false);
  });

  it('rechaza lo previsible aunque sea largo', () => {
    for (const mala of ['contrasena123', 'Password2026', 'supricom2026', '123456789012']) {
      expect(evaluarFortaleza(mala).ok, `deberia rechazar "${mala}"`).toBe(false);
    }
  });

  it('rechaza un único carácter repetido', () => {
    expect(evaluarFortaleza('aaaaaaaaaaaaaaa').ok).toBe(false);
  });

  it('rechaza que contenga el propio correo o nombre', () => {
    const r = evaluarFortaleza('jperez-cosa-larga', ['jperez@supricom.com.ve']);
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/correo/i);
  });

  it('rechaza una contraseña absurdamente larga', () => {
    // Sin límite, un POST de 10 MB se convierte en denegación de servicio:
    // Argon2 tendría que procesarlo entero antes de rechazarlo.
    expect(evaluarFortaleza('x'.repeat(5000)).ok).toBe(false);
  });

  it('acepta una frase razonable', () => {
    expect(evaluarFortaleza('el gato azul come pan').ok).toBe(true);
    expect(evaluarFortaleza('T0rn1ll0-Verde-Lunes').ok).toBe(true);
  });

  it('NO exige mayúsculas, números ni símbolos', () => {
    // Esas reglas producen "Passw0rd!" y empujan a apuntar la clave en un papel.
    expect(evaluarFortaleza('correcaballobateriagrapa').ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#52 · Secretos de un solo uso', () => {
  it('emite un secreto y su hash', () => {
    const s = emitirSecreto();
    expect(s.plaintext.length).toBeGreaterThanOrEqual(43);
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.hash).toBe(hashSecreto(s.plaintext));
  });

  it('dos secretos nunca coinciden', () => {
    const vistos = new Set(Array.from({ length: 500 }, () => emitirSecreto().plaintext));
    expect(vistos.size).toBe(500);
  });

  it('el hash no permite recuperar el secreto', () => {
    const s = emitirSecreto();
    expect(s.hash).not.toContain(s.plaintext);
    expect(s.plaintext).not.toContain(s.hash);
  });

  it('compararHash acierta y falla donde debe', () => {
    const a = hashSecreto('uno');
    expect(compararHash(a, hashSecreto('uno'))).toBe(true);
    expect(compararHash(a, hashSecreto('dos'))).toBe(false);
    expect(compararHash(a, 'corto')).toBe(false);
    expect(compararHash('', '')).toBe(true);
  });

  it('las caducidades se calculan bien', () => {
    const d = caducaEnDias(30);
    expect(d.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(d.getTime()).toBeLessThan(Date.now() + 31 * 86_400_000);

    expect(haCaducado(caducaEnMinutos(60))).toBe(false);
    expect(haCaducado(caducaEnMinutos(-1))).toBe(true);
    expect(haCaducado(null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#52 · Access tokens', () => {
  const claims = {
    sub: '11111111-2222-4333-8444-555555555555',
    role: 'VENDEDOR' as const,
    odooPartnerId: 4512,
    odooUserId: 406,
    sid: '99999999-8888-4777-8666-555555555555',
  };

  it('emite y verifica, conservando los claims', async () => {
    const t = await emitirAccessToken(claims);
    const v = await verificarAccessToken(t);
    expect(v).toEqual(claims);
  });

  it('rechaza un token con la firma cambiada', async () => {
    const t = await emitirAccessToken(claims);
    const [h, p] = t.split('.');
    const manipulado = `${h}.${p}.firmaInventadaQueNoCorresponde`;
    await expect(verificarAccessToken(manipulado)).rejects.toThrow(TokenInvalido);
  });

  it('rechaza un payload manipulado aunque parezca válido', async () => {
    // El caso que importa: escalar de VENDEDOR a SUPERADMIN editando el payload.
    // Va en base64, no cifrado — cualquiera puede reescribirlo. Lo que lo
    // impide es la firma, no el secreto del contenido.
    const t = await emitirAccessToken(claims);
    const [h, p, s] = t.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.role = 'SUPERADMIN';
    const nuevo = Buffer.from(JSON.stringify(payload)).toString('base64url');
    await expect(verificarAccessToken(`${h}.${nuevo}.${s}`)).rejects.toThrow(TokenInvalido);
  });

  it('rechaza basura y cadenas vacías', async () => {
    for (const malo of ['', 'no-es-un-jwt', 'a.b.c', 'Bearer algo']) {
      await expect(verificarAccessToken(malo)).rejects.toThrow(TokenInvalido);
    }
  });

  it('rechaza un token firmado con OTRA clave', async () => {
    const t = await emitirAccessToken(claims);
    process.env.JWT_SECRET = 'una-clave-completamente-distinta-de-32-o-mas';
    resetAuthEnvCache();
    await expect(verificarAccessToken(t)).rejects.toThrow(TokenInvalido);

    process.env.JWT_SECRET = 'clave-de-pruebas-con-mas-de-treinta-y-dos-caracteres';
    resetAuthEnvCache();
  });

  it('rechaza un token de otro emisor', async () => {
    process.env.JWT_ISSUER = 'otro-sistema';
    resetAuthEnvCache();
    const ajeno = await emitirAccessToken(claims);

    process.env.JWT_ISSUER = 'asta-middleware';
    resetAuthEnvCache();
    await expect(verificarAccessToken(ajeno)).rejects.toThrow(TokenInvalido);
  });

  it('caduca', async () => {
    process.env.JWT_ACCESS_TTL = '1s';
    resetAuthEnvCache();
    const t = await emitirAccessToken(claims);

    await new Promise((r) => setTimeout(r, 1600));
    await expect(verificarAccessToken(t)).rejects.toMatchObject({ motivo: 'expirado' });

    process.env.JWT_ACCESS_TTL = '15m';
    resetAuthEnvCache();
  });

  it('el payload NO lleva nada sensible', async () => {
    const t = await emitirAccessToken(claims);
    const payload = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    const claves = Object.keys(payload).sort();
    // Si alguien añade email, nombre o cualquier dato de negocio, este test cae.
    expect(claves).toEqual(['aud', 'exp', 'iat', 'iss', 'odooPartnerId', 'odooUserId', 'role', 'sid', 'sub']);
  });

  it('bearerDe extrae el token del header', () => {
    expect(bearerDe('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerDe('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerDe('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerDe(undefined)).toBeNull();
    expect(bearerDe('')).toBeNull();
  });
});
