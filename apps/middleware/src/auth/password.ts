import { Algorithm, hash, verify } from '@node-rs/argon2';
import { authEnv } from '../config/authEnv.js';

/**
 * Contraseñas.
 *
 * ── Por qué Argon2id y no HMAC ───────────────────────────────────────────────
 *
 * Es el caso OPUESTO al de las API keys. Allí el secreto son 32 bytes de CSPRNG:
 * no hay diccionario que atacar, así que basta un HMAC rápido. Aquí el secreto
 * lo elige una persona, tiene poca entropía y existen listas de millones de
 * contraseñas reales. Hace falta un KDF **deliberadamente lento**.
 *
 * Nunca SHA-256, nunca MD5, nunca un hash rápido de ningún tipo.
 *
 * ── Formato ──────────────────────────────────────────────────────────────────
 *
 * Se guarda el string PHC completo:
 *
 *     $argon2id$v=19$m=65536,t=3,p=1$<sal>$<hash>
 *
 * Incluye la sal y los parámetros, así que no hace falta columna de sal y se
 * puede subir el coste sin invalidar las contraseñas existentes: cada hash sabe
 * con qué parámetros se creó.
 */

/** Longitud mínima. Corta a propósito: la longitud sola no mide gran cosa. */
export const LONGITUD_MINIMA = 10;

export interface FortalezaResultado {
  ok: boolean;
  motivos: string[];
}

/**
 * Comprobación de fortaleza.
 *
 * NO exige mayúsculas, números ni símbolos. Esas reglas producen `Passw0rd!` —
 * que cumple todo y está en cualquier diccionario— y empujan a la gente a
 * apuntarlas en un papel. La longitud y evitar lo obvio protegen más.
 */
export function evaluarFortaleza(plain: string, contexto: string[] = []): FortalezaResultado {
  const motivos: string[] = [];
  const p = plain.trim();

  if (p.length < LONGITUD_MINIMA) {
    motivos.push(`Debe tener al menos ${LONGITUD_MINIMA} caracteres.`);
  }
  // Límite alto pero existente: sin él, un POST de 10 MB se convierte en una
  // denegación de servicio, porque Argon2 tendría que procesarlo entero.
  if (p.length > 200) {
    motivos.push('No puede superar los 200 caracteres.');
  }
  if (/^(.)\1+$/.test(p)) {
    motivos.push('No puede ser un único carácter repetido.');
  }

  const normalizado = p.toLowerCase();
  const prohibidas = [
    'contrasena', 'contraseña', 'password', 'passw0rd', '12345678', '123456789',
    'qwertyui', 'asta2025', 'asta2026', 'supricom', 'administrador', 'bienvenido',
  ];
  if (prohibidas.some((x) => normalizado.includes(x))) {
    motivos.push('Contiene una secuencia demasiado común o previsible.');
  }

  // El propio email o nombre como contraseña es lo primero que se prueba.
  for (const c of contexto) {
    const limpio = c.toLowerCase().split('@')[0];
    if (limpio.length >= 4 && normalizado.includes(limpio)) {
      motivos.push('No puede contener tu nombre o tu dirección de correo.');
      break;
    }
  }

  return { ok: motivos.length === 0, motivos };
}

function opciones() {
  const e = authEnv();
  return {
    algorithm: Algorithm.Argon2id,
    memoryCost: e.ARGON2_MEMORY_KIB,
    timeCost: e.ARGON2_ITERATIONS,
    parallelism: e.ARGON2_PARALLELISM,
  };
}

export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error('La contraseña no puede estar vacía');
  return hash(plain, opciones());
}

/**
 * Verifica una contraseña.
 *
 * Devuelve `false` en vez de lanzar cuando el hash guardado está corrupto o en
 * un formato desconocido: desde fuera, "no coincide" y "el registro está roto"
 * deben ser indistinguibles. Si lanzara, la diferencia entre un 500 y un 401 le
 * diría al atacante que esa cuenta existe y tiene algo raro.
 */
export async function verifyPassword(hashGuardado: string, plain: string): Promise<boolean> {
  if (!hashGuardado || !plain) return false;
  try {
    return await verify(hashGuardado, plain);
  } catch {
    return false;
  }
}

/**
 * ¿Este hash se creó con parámetros más débiles que los actuales?
 *
 * Permite subir el coste sin obligar a nadie a cambiar de contraseña: en el
 * siguiente login correcto se vuelve a hashear con los parámetros nuevos. Sin
 * esto, subir el coste solo protege a los usuarios futuros.
 */
export function necesitaRehash(hashGuardado: string): boolean {
  const e = authEnv();
  const m = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hashGuardado);
  if (!m) return true; // formato desconocido o algoritmo antiguo: rehashear

  const [, mem, iter, par] = m;
  return (
    Number(mem) < e.ARGON2_MEMORY_KIB ||
    Number(iter) < e.ARGON2_ITERATIONS ||
    Number(par) < e.ARGON2_PARALLELISM
  );
}
