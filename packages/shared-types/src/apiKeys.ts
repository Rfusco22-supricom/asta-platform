import { z } from 'zod';
import { apiScopeSchema } from './identity.js';

/**
 * API Keys de cliente. Lo consume la UI del panel (issue #28) contra los
 * endpoints de Track B.
 */

export const apiKeyEnvSchema = z.enum(['LIVE', 'TEST']);
export type ApiKeyEnv = z.infer<typeof apiKeyEnvSchema>;

/**
 * Formato del token:  asta_live_<prefix:8>_<secret:43>
 *
 * El prefijo `asta_live_` es visible a propósito: permite que los escáneres de
 * secretos de GitHub lo reconozcan cuando un cliente suba su key a un repo
 * público por accidente.
 */
export const API_KEY_PATTERN = /^asta_(live|test)_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

export const apiKeyTokenSchema = z.string().regex(API_KEY_PATTERN, 'Formato de API key inválido');

/** Lo que se muestra en el listado. Nunca incluye el secreto. */
export const apiKeySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  environment: apiKeyEnvSchema,
  prefix: z.string(),
  /** Últimos 4 caracteres, solo para que el usuario reconozca cuál es cuál. */
  lastFour: z.string().length(4),
  scopes: z.array(apiScopeSchema),
  rateLimitPerMinute: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  usageCount: z.number().int().nonnegative(),
});

export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;

export const createApiKeyRequestSchema = z.object({
  name: z.string().min(3).max(60),
  /**
   * Al menos un scope, elegido explícitamente. Ninguna key debe poder nacer con
   * "todos los permisos" por defecto: el cliente tiene que decidir qué le da a
   * su integración.
   */
  scopes: z.array(apiScopeSchema).min(1),
  environment: apiKeyEnvSchema.default('LIVE'),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

/**
 * Respuesta de creación. Es la ÚNICA vez que el secreto viaja: no se guarda en
 * claro en ningún lado y no hay endpoint que lo recupere.
 *
 * La UI debe dejarlo claro antes de que el usuario cierre el diálogo.
 */
export const createApiKeyResponseSchema = apiKeySummarySchema.extend({
  plaintext: apiKeyTokenSchema,
  advertencia: z
    .literal('Guarda este token ahora. No volverá a mostrarse.')
    .default('Guarda este token ahora. No volverá a mostrarse.'),
});

export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;

export const revokeApiKeyRequestSchema = z.object({
  reason: z.string().max(200).optional(),
});

export type RevokeApiKeyRequest = z.infer<typeof revokeApiKeyRequestSchema>;

/** Fila del historial de uso que se muestra bajo cada key. */
export const apiKeyUsageRowSchema = z.object({
  method: z.string(),
  path: z.string(),
  statusCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  cacheHit: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type ApiKeyUsageRow = z.infer<typeof apiKeyUsageRowSchema>;
