import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ErrorCode } from '@asta/shared-types';
import { env } from '../config/env.js';

/**
 * Enlaces firmados y temporales para descargar el PDF de una factura (#32).
 *
 * El enlace se entrega a quien tiene una API key, pero la descarga NO pide la
 * key: tiene que poder abrirse desde un navegador o reenviarse a contabilidad.
 * Por eso lo que autoriza la descarga es la firma, y la firma tiene que atar
 * todo lo que importa:
 *
 *   · qué factura y qué adjunto   — cambiar un id invalida la firma
 *   · para qué cliente y con qué key — la descarga vuelve a comprobar las dos
 *   · hasta cuándo                — 5 minutos por defecto
 *
 * ── Formato ──────────────────────────────────────────────────────────────────
 *
 *   base64url(JSON del contenido) . base64url(HMAC-SHA256)
 *
 * Es un JWT sin cabecera, a propósito: sin campo `alg` no hay forma de pedir
 * `alg: none` ni de cambiar de algoritmo. Hay uno solo.
 *
 * ── La clave ─────────────────────────────────────────────────────────────────
 *
 * Se DERIVA de `API_KEY_PEPPER` con HKDF y una etiqueta propia, en vez de pedir
 * otra variable de entorno. La etiqueta separa los usos: la clave de los enlaces
 * no sirve para nada relacionado con el hash de las API keys, ni al revés.
 *
 * Consecuencia que hay que documentar en #45: rotar el pepper invalida también
 * los enlaces en vuelo. Como duran minutos, da igual.
 */

const ETIQUETA = 'asta/enlaces-pdf-factura/v1';
export const TTL_ENLACE_SEGUNDOS = 5 * 60;

const contenidoSchema = z.strictObject({
  /** account.move */
  f: z.number().int().positive(),
  /** ir.attachment */
  a: z.number().int().positive(),
  /** partner del token que pidió el enlace */
  p: z.number().int().positive(),
  /** api_keys.id */
  k: z.uuid(),
  /** caducidad, epoch en segundos */
  exp: z.number().int().positive(),
});

export interface ContenidoEnlace {
  facturaId: number;
  adjuntoId: number;
  partnerId: number;
  apiKeyId: string;
  /** Epoch en segundos. */
  expira: number;
}

export type ResultadoEnlace =
  | { ok: true; contenido: ContenidoEnlace }
  | { ok: false; motivo: 'MALFORMADO' | 'FIRMA_INVALIDA' | 'CADUCADO' };

let claveCache: { pepper: string; clave: Buffer } | null = null;

function clave(): Buffer {
  const pepper = env().API_KEY_PEPPER;
  if (claveCache?.pepper !== pepper) {
    claveCache = { pepper, clave: Buffer.from(hkdfSync('sha256', pepper, 'asta', ETIQUETA, 32)) };
  }
  return claveCache.clave;
}

function firmar(cuerpo: string): Buffer {
  return createHmac('sha256', clave()).update(cuerpo).digest();
}

export function firmarEnlace(
  datos: Omit<ContenidoEnlace, 'expira'>,
  ahoraSegundos = Math.floor(Date.now() / 1000),
  ttlSegundos = TTL_ENLACE_SEGUNDOS,
): { token: string; expira: number } {
  const expira = ahoraSegundos + ttlSegundos;
  const cuerpo = Buffer.from(
    JSON.stringify({ f: datos.facturaId, a: datos.adjuntoId, p: datos.partnerId, k: datos.apiKeyId, exp: expira }),
  ).toString('base64url');
  return { token: `${cuerpo}.${firmar(cuerpo).toString('base64url')}`, expira };
}

/**
 * Verifica un token. El orden importa: primero la FIRMA y solo después se lee
 * el contenido. Parsear JSON de alguien que no ha demostrado nada es superficie
 * gratis para el que prueba.
 */
export function verificarEnlace(token: string, ahoraSegundos = Math.floor(Date.now() / 1000)): ResultadoEnlace {
  const partes = token.split('.');
  if (partes.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(partes[0]) || !/^[A-Za-z0-9_-]+$/.test(partes[1])) {
    return { ok: false, motivo: 'MALFORMADO' };
  }
  const [cuerpo, firma] = partes;

  const esperada = firmar(cuerpo);
  const recibida = Buffer.from(firma, 'base64url');
  // timingSafeEqual exige la misma longitud; comprobarla antes no filtra nada
  // útil: la longitud de un HMAC-SHA256 es pública.
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    return { ok: false, motivo: 'FIRMA_INVALIDA' };
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, motivo: 'MALFORMADO' };
  }
  const parsed = contenidoSchema.safeParse(json);
  if (!parsed.success) return { ok: false, motivo: 'MALFORMADO' };

  const { f, a, p, k, exp } = parsed.data;
  if (exp <= ahoraSegundos) return { ok: false, motivo: 'CADUCADO' };

  return { ok: true, contenido: { facturaId: f, adjuntoId: a, partnerId: p, apiKeyId: k, expira: exp } };
}

/**
 * Quita el token de una URL antes de que llegue a un log.
 *
 * `pino-http` registra `req.url`, y en la descarga la URL ES la credencial
 * durante 5 minutos. Un log se copia a un ticket sin pensarlo.
 */
export function ocultarTokenDeUrl(url: string): string {
  return url.replace(/(\/descargas\/facturas\/)[^/?#]+/, '$1[oculto]');
}

/** Todo lo que no autoriza una descarga, salvo la caducidad. Siempre el mismo 404. */
export class EnlaceNoValido extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'LINK_NOT_VALID';

  constructor() {
    super('Enlace no válido.');
    this.name = 'EnlaceNoValido';
  }
}

export class EnlaceCaducado extends Error {
  readonly status = 410;
  readonly code: ErrorCode = 'LINK_EXPIRED';

  constructor() {
    super('El enlace ha caducado. Pide uno nuevo a la API.');
    this.name = 'EnlaceCaducado';
  }
}
