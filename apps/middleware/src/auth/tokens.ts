import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secretos de un solo uso: refresh tokens, invitaciones, reseteo de contraseña.
 *
 * Los tres comparten la misma forma —un secreto aleatorio que viaja al usuario y
 * del que la base solo guarda el hash— así que comparten el mismo módulo.
 *
 * ── Por qué SHA-256 y no Argon2 ──────────────────────────────────────────────
 *
 * Igual que con las API keys: estos secretos son 32 bytes de CSPRNG, no algo que
 * eligió una persona. No hay diccionario que probar, así que un KDF lento solo
 * añadiría latencia. Lo que protege aquí es la entropía, no el coste.
 *
 * ── Por qué se guarda el hash ────────────────────────────────────────────────
 *
 * Quien consiga leer `user_sessions` o `auth_tokens` no puede suplantar a nadie
 * ni aceptar invitaciones ajenas. Guardar el token en claro convertiría un
 * volcado de la base en acceso inmediato a todas las cuentas.
 */

/** 32 bytes = 256 bits. base64url para que viaje en una URL sin escapar nada. */
const BYTES = 32;

export interface SecretoEmitido {
  /** Lo que viaja al usuario. No se guarda en ningún sitio. */
  plaintext: string;
  /** Lo único que se guarda. SHA-256 en hex, 64 caracteres. */
  hash: string;
}

export function emitirSecreto(): SecretoEmitido {
  const plaintext = randomBytes(BYTES).toString('base64url');
  return { plaintext, hash: hashSecreto(plaintext) };
}

export function hashSecreto(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Compara dos hashes en tiempo constante.
 *
 * Un `===` sobre strings sale en cuanto encuentra el primer byte distinto, y esa
 * diferencia de microsegundos es medible. Con suficientes intentos permite
 * reconstruir un token byte a byte.
 *
 * La comprobación de longitud previa no filtra nada útil: los hashes SHA-256
 * siempre miden 64 caracteres, así que una longitud distinta solo significa
 * entrada malformada.
 */
export function compararHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** Fecha de caducidad a N días vista. */
export function caducaEnDias(dias: number): Date {
  return new Date(Date.now() + dias * 86_400_000);
}

/** Fecha de caducidad a N minutos vista. Para invitaciones y reseteos. */
export function caducaEnMinutos(minutos: number): Date {
  return new Date(Date.now() + minutos * 60_000);
}

export function haCaducado(fecha: Date | null | undefined): boolean {
  return !fecha || fecha.getTime() <= Date.now();
}
