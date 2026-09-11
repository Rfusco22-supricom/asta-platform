import { SignJWT, jwtVerify, errors } from 'jose';
import type { AppRole } from '@asta/shared-types';
import { authEnv } from '../config/authEnv.js';

/**
 * Access tokens.
 *
 * ── Por qué el access token es corto y no se guarda ──────────────────────────
 *
 * Un JWT firmado no se puede revocar: mientras no caduque, es válido. Por eso
 * dura 15 minutos y lleva dentro solo lo imprescindible. La sesión de verdad —la
 * que se puede cerrar— es el refresh token, que sí vive en la base y se revoca.
 *
 * Consecuencia asumida: si a alguien se le retira el acceso, su access token
 * sigue sirviendo hasta 15 minutos. Para cerrar esa ventana habría que consultar
 * la base en cada request, que es justo lo que el JWT evita. En un panel interno
 * el intercambio compensa; si algún día deja de compensar, el sitio donde
 * cambiarlo es `authJwt()`.
 *
 * ── Qué NO va dentro ─────────────────────────────────────────────────────────
 *
 * Nada que el usuario no deba ver. El payload de un JWT va en base64, no
 * cifrado: cualquiera con el token lee su contenido. Ni emails de terceros, ni
 * importes, ni nada que no sea identidad.
 */

export interface AccessTokenClaims {
  /** app_users.id */
  sub: string;
  role: AppRole;
  odooPartnerId: number;
  odooUserId: number | null;
  /** ID de la sesión (user_sessions.id) que originó este token. */
  sid: string;
}

export class TokenInvalido extends Error {
  constructor(readonly motivo: 'expirado' | 'firma' | 'malformado' | 'claims') {
    super(`Token inválido: ${motivo}`);
    this.name = 'TokenInvalido';
  }
}

function clave(): Uint8Array {
  return new TextEncoder().encode(authEnv().JWT_SECRET);
}

export async function emitirAccessToken(claims: AccessTokenClaims): Promise<string> {
  const e = authEnv();

  return new SignJWT({
    role: claims.role,
    odooPartnerId: claims.odooPartnerId,
    odooUserId: claims.odooUserId,
    sid: claims.sid,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(e.JWT_ISSUER)
    .setAudience(e.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(e.JWT_ACCESS_TTL)
    .sign(clave());
}

/**
 * Verifica firma, caducidad, emisor y audiencia.
 *
 * `issuer` y `audience` no son ceremonia: sin comprobarlos, un token emitido por
 * otro sistema que comparta la clave —o por este mismo para otro propósito—
 * serviría aquí.
 */
export async function verificarAccessToken(token: string): Promise<AccessTokenClaims> {
  const e = authEnv();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, clave(), {
      issuer: e.JWT_ISSUER,
      audience: e.JWT_AUDIENCE,
      algorithms: ['HS256'], // fija el algoritmo: evita el ataque de "alg: none"
    }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new TokenInvalido('expirado');
    if (error instanceof errors.JWSSignatureVerificationFailed) throw new TokenInvalido('firma');
    throw new TokenInvalido('malformado');
  }

  const { sub, role, odooPartnerId, odooUserId, sid } = payload as Record<string, unknown>;

  if (
    typeof sub !== 'string' ||
    typeof role !== 'string' ||
    typeof odooPartnerId !== 'number' ||
    typeof sid !== 'string'
  ) {
    throw new TokenInvalido('claims');
  }

  return {
    sub,
    role: role as AppRole,
    odooPartnerId,
    odooUserId: typeof odooUserId === 'number' ? odooUserId : null,
    sid,
  };
}

/** Extrae el token de `Authorization: Bearer <token>`. */
export function bearerDe(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
