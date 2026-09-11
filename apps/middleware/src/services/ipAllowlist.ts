/**
 * Comparacion de una IP contra la lista blanca de una API key.
 *
 * La columna `api_key_allowed_ips.cidr` se documenta en el esquema como
 * `"200.44.1.10" o "200.44.1.0/24"`, es decir: admite direcciones exactas y
 * rangos. Antes se comparaba con `includes(ip)`, igualdad exacta de cadenas,
 * de modo que un rango no coincidia NUNCA con ninguna IP: la lista rechazaba
 * todo el rango mientras el operador creia tenerlo permitido.
 *
 * Reglas, en orden:
 *
 *   1. Sin `/`  -> comparacion exacta, tras normalizar.
 *   2. Con `/` sobre IPv4 -> comparacion por mascara de bits.
 *   3. Con `/` sobre IPv6 -> NO SOPORTADO, y por tanto no coincide.
 *
 * El caso 3 es deliberado. Escribir a mano un parser de IPv6 —con la expansion
 * de `::` y sus casos raros— para un control de seguridad es mas peligroso que
 * no soportarlo: un fallo ahi no rompe nada visible, simplemente deja pasar a
 * quien no debe. Si alguna vez hace falta, se usa una libreria probada. Hasta
 * entonces, una IPv6 exacta si funciona (regla 1), que cubre el caso real.
 */

/**
 * Deja la direccion en su forma canonica para comparar.
 *
 * Node entrega `::ffff:200.44.1.10` cuando el socket es IPv6 pero el cliente
 * llego por IPv4 — que es lo habitual detras de un proxy. Sin desenvolver ese
 * prefijo, una lista blanca escrita en IPv4 no casaria jamas en produccion.
 */
export function normalizarIp(valor: string): string {
  let ip = valor.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  // Identificador de zona: `fe80::1%en0`.
  const zona = ip.indexOf('%');
  if (zona !== -1) ip = ip.slice(0, zona);
  // IPv4 envuelta en IPv6.
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapeada?.[1]) return mapeada[1];
  return ip;
}

function esIpv4(valor: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(valor);
}

/** Devuelve la IPv4 como entero de 32 bits, o null si no es valida. */
function ipv4ANumero(valor: string): number | null {
  const partes = valor.split('.');
  if (partes.length !== 4) return null;

  let acumulado = 0;
  for (const parte of partes) {
    const octeto = Number(parte);
    if (!Number.isInteger(octeto) || octeto < 0 || octeto > 255) return null;
    // `>>> 0` mantiene el resultado sin signo: sin eso, 200.x.x.x sale negativo.
    acumulado = ((acumulado << 8) | octeto) >>> 0;
  }
  return acumulado;
}

/** ¿La IP cae dentro de la entrada de lista blanca indicada? */
export function ipCoincide(entrada: string, ip: string): boolean {
  const objetivo = normalizarIp(ip);
  const patron = normalizarIp(entrada);
  if (objetivo === '' || patron === '') return false;

  const barra = patron.indexOf('/');
  if (barra === -1) return patron === objetivo;

  const base = patron.slice(0, barra);
  const bits = Number(patron.slice(barra + 1));

  if (!esIpv4(base) || !esIpv4(objetivo)) return false; // regla 3
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const baseNum = ipv4ANumero(base);
  const objetivoNum = ipv4ANumero(objetivo);
  if (baseNum === null || objetivoNum === null) return false;

  if (bits === 0) return true;
  // Desplazar 32 en JS no hace nada (el operador usa modulo 32), de ahi el caso
  // aparte para /32.
  const mascara = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (baseNum & mascara) === (objetivoNum & mascara);
}

/**
 * ¿Este origen esta permitido?
 *
 * Una lista vacia significa "sin restriccion de origen". Con la lista poblada y
 * una IP desconocida se DENIEGA: una lista blanca tiene que fallar cerrada. Lo
 * contrario convertia una key restringida en una key sin restriccion justo
 * cuando no se podia determinar de donde venia el request.
 */
export function origenPermitido(entradas: readonly string[], ip: string | undefined): boolean {
  if (entradas.length === 0) return true;
  if (!ip) return false;
  return entradas.some((entrada) => ipCoincide(entrada, ip));
}
