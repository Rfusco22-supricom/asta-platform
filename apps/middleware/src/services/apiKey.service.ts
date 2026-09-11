import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiScope, ApiKeyEnv } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

/**
 * Emisión y verificación de API keys de cliente.
 *
 * Formato:  asta_live_<prefix>_<secret>
 *           └ marca ┘└env┘└ 8 hex ┘└ 43 chars base64url = 32 bytes ┘
 *
 * Por qué así:
 *
 * · El prefijo va en claro e indexado -> encontrar la fila es un índice único,
 *   no un table scan hasheando fila por fila.
 * · El hash es HMAC-SHA256 con un pepper de entorno, no bcrypt. bcrypt cuesta
 *   ~100 ms; a 60 req/min por key eso es tiempo de CPU regalado. Un KDF lento
 *   protege secretos de baja entropía (contraseñas humanas); aquí el secreto son
 *   32 bytes de CSPRNG: no hay diccionario que atacar.
 * · El pepper vive en el entorno y no en la BD: una exfiltración de `api_keys`
 *   no alcanza para verificar un solo token.
 * · El prefijo con marca visible (`asta_live_`) permite que los escáneres de
 *   secretos de GitHub lo detecten cuando un cliente lo suba a un repo público.
 */

const TOKEN_REGEX = /^asta_(live|test)_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export interface IssuedApiKey {
  id: string;
  /** El token completo. Se devuelve UNA vez y no se puede recuperar después. */
  plaintext: string;
  prefix: string;
  lastFour: string;
  scopes: ApiScope[];
  expiresAt: Date | null;
}

function hashToken(token: string): string {
  return createHmac('sha256', env().API_KEY_PEPPER).update(token).digest('hex');
}

export async function issueApiKey(params: {
  userId: string;
  name: string;
  scopes: ApiScope[];
  environment?: ApiKeyEnv;
  expiresInDays?: number;
  rateLimitPerMinute?: number;
  createdFromIp?: string;
}): Promise<IssuedApiKey> {
  if (params.scopes.length === 0) {
    throw new Error('Una API key debe nacer con al menos un scope explícito');
  }

  const environment = params.environment ?? 'LIVE';
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `asta_${environment.toLowerCase()}_${prefix}_${secret}`;

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 86_400_000)
    : null;

  const record = await prisma.apiKey.create({
    data: {
      userId: params.userId,
      name: params.name,
      environment,
      prefix,
      keyHash: hashToken(plaintext),
      lastFour: secret.slice(-4),
      // MySQL no tiene arrays: los scopes viven en tabla puente y se insertan
      // en la misma transacción implícita que la key. Una key nunca existe sin
      // sus permisos.
      scopes: { create: params.scopes.map((scope) => ({ scope })) },
      rateLimitPerMinute: params.rateLimitPerMinute ?? 60,
      expiresAt,
      createdFrom: params.createdFromIp,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: params.userId,
      action: 'api_key.created',
      targetType: 'ApiKey',
      targetId: record.id,
      metadata: { name: params.name, scopes: params.scopes, environment, expiresAt },
      ip: params.createdFromIp,
    },
  });

  return {
    id: record.id,
    plaintext,
    prefix,
    lastFour: secret.slice(-4),
    scopes: params.scopes,
    expiresAt,
  };
}

export type VerifyFailure =
  | 'MALFORMED'
  | 'NOT_FOUND'
  | 'REVOKED'
  | 'EXPIRED'
  | 'USER_INACTIVE'
  | 'IP_NOT_ALLOWED';

export interface VerifiedIdentity {
  apiKeyId: string;
  appUserId: string;
  role: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE' | 'PLATA' | 'GOLD';
  odooPartnerId: number;
  odooUserId: number | null;
  odooPricelistId: number | null;
  scopes: ApiScope[];
  rateLimitPerMinute: number;
}

export type VerifyResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: VerifyFailure };

/**
 * Verifica un token. Coste: un índice único + un HMAC. Sin RPC a Odoo.
 *
 * El motivo de devolver siempre el mismo 401 hacia afuera (y el detalle solo por
 * log) es no darle al atacante un oráculo que distinga "esta key no existe" de
 * "esta key existe pero expiró".
 */
export async function verifyApiKey(rawToken: string, ip?: string): Promise<VerifyResult> {
  const match = TOKEN_REGEX.exec(rawToken.trim());
  if (!match) return { ok: false, reason: 'MALFORMED' };

  const [, , prefix] = match;

  // Un solo round-trip: la key, su dueño, sus scopes y su lista blanca.
  // Los dos `include` de abajo son el coste de que MySQL no tenga arrays —dos
  // JOIN sobre índices de clave primaria— y es lo que se paga a cambio de que
  // el motor impida guardar un scope inventado.
  const key = await prisma.apiKey.findUnique({
    where: { prefix },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          isActive: true,
          odooPartnerId: true,
          odooUserId: true,
          odooPricelistId: true,
        },
      },
      scopes: { select: { scope: true } },
      allowedIps: { select: { cidr: true } },
    },
  });

  // Se calcula el HMAC aunque la fila no exista, para que el tiempo de respuesta
  // no revele si el prefijo es válido.
  const candidate = Buffer.from(hashToken(rawToken), 'utf8');
  const stored = Buffer.from(key?.keyHash ?? '0'.repeat(64), 'utf8');
  const hashMatches = candidate.length === stored.length && timingSafeEqual(candidate, stored);

  if (!key || !hashMatches) return { ok: false, reason: 'NOT_FOUND' };
  if (key.revokedAt) return { ok: false, reason: 'REVOKED' };
  if (key.expiresAt && key.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };
  if (!key.user.isActive) return { ok: false, reason: 'USER_INACTIVE' };
  const allowedIps = key.allowedIps.map((row) => row.cidr);
  if (allowedIps.length > 0 && ip && !allowedIps.includes(ip)) {
    return { ok: false, reason: 'IP_NOT_ALLOWED' };
  }

  // `lastUsedAt` se actualiza fuera del camino crítico: no se espera al INSERT
  // para responderle al cliente.
  void prisma.apiKey
    .update({
      where: { id: key.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ip, usageCount: { increment: 1 } },
    })
    .catch(() => {
      /* la telemetría nunca debe tumbar un request */
    });

  return {
    ok: true,
    identity: {
      apiKeyId: key.id,
      appUserId: key.user.id,
      role: key.user.role,
      odooPartnerId: key.user.odooPartnerId,
      odooUserId: key.user.odooUserId,
      odooPricelistId: key.user.odooPricelistId,
      scopes: key.scopes.map((row) => row.scope),
      rateLimitPerMinute: key.rateLimitPerMinute,
    },
  };
}

export async function revokeApiKey(
  apiKeyId: string,
  revokedByUserId: string,
  reason?: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date(), revokedById: revokedByUserId, revokeReason: reason },
    }),
    prisma.auditLog.create({
      data: {
        actorId: revokedByUserId,
        action: 'api_key.revoked',
        targetType: 'ApiKey',
        targetId: apiKeyId,
        metadata: { reason: reason ?? null },
      },
    }),
  ]);
}
