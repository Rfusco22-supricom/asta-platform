/**
 * Normalización de direcciones de correo.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `app_users.email` usa colación BINARIA (`utf8mb4_bin`), así que la base
 * distingue mayúsculas: para ella `Jose@x.com` y `jose@x.com` son dos usuarios.
 *
 * No es un descuido. Se buscó una colación que ignorase mayúsculas pero
 * respetase acentos, y en MariaDB 10.4 NO EXISTE — comprobado con literales hex
 * para que el charset de la consola no falseara el resultado:
 *
 *     utf8mb4_general_ci      ignora mayús.  IGNORA ACENTOS
 *     utf8mb4_unicode_ci      ignora mayús.  IGNORA ACENTOS
 *     utf8mb4_spanish_ci      ignora mayús.  IGNORA ACENTOS
 *     utf8mb4_unicode_520_ci  ignora mayús.  IGNORA ACENTOS
 *     utf8mb4_bin             distingue      respeta acentos
 *
 * Con cualquier `_ci`, `jose@x.com` y `josé@x.com` serían el MISMO usuario y el
 * segundo no podría darse de alta nunca.
 *
 * Así que la base respeta los acentos y esta función aporta la insensibilidad a
 * mayúsculas.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * TODA escritura y TODA búsqueda por email pasa por aquí. Sin excepciones: si un
 * solo camino se la salta, se cuelan cuentas duplicadas que la base ya no impide,
 * y el usuario afectado no podrá entrar porque el login busca el valor
 * normalizado.
 */

/**
 * Pasa a minúsculas y recorta espacios.
 *
 * NO se hace nada más. En concreto, NO se quitan los puntos del usuario ni lo
 * que va tras un `+`, aunque Gmail los ignore: eso es política de UN proveedor,
 * no del correo electrónico. Aplicarlo a todos rompería direcciones legítimas de
 * dominios que sí distinguen.
 *
 * Técnicamente el RFC 5321 permite que la parte local distinga mayúsculas, pero
 * ningún proveedor real lo hace, y tratarlas como distintas confundiría a
 * cualquiera que teclee su correo con la primera letra en mayúscula.
 */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Comprobación mínima de forma. La validación de verdad es enviar el correo. */
const FORMA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function esEmailPlausible(email: string): boolean {
  const e = normalizarEmail(email);
  // 254 es el máximo del RFC 5321 para una dirección completa.
  return e.length <= 254 && FORMA.test(e);
}

/**
 * Normaliza y valida de una vez. Devuelve null si no tiene forma de correo.
 *
 * Pensado para usarse en el borde: un handler recibe texto del usuario, llama a
 * esto, y a partir de ahí solo circula un email normalizado.
 */
export function emailValido(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = normalizarEmail(email);
  return esEmailPlausible(e) ? e : null;
}
