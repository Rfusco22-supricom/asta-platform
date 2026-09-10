import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApiScope } from '@prisma/client';
import { verifyApiKey, type VerifiedIdentity } from '../services/apiKey.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Identidad resuelta, sea por JWT (panel/app) o por API key (integraciones).
       * Ambos caminos producen la MISMA forma para que los controladores no tengan
       * que saber cómo entró el request.
       */
      identity: VerifiedIdentity;
      /** partner_id efectivo, derivado del token — nunca del input del cliente. */
      scopedPartnerId?: number;
      /** Logger por request (pino-http). */
      log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
    }
  }
}

/**
 * Autenticación por API key para la API pública.
 *
 * El token se lee del header `X-API-Key` (o `Authorization: Bearer`). Nunca de la
 * query string: los query params acaban en logs de acceso, en el Referer y en el
 * historial de proxies.
 */
export function authApiKey(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('x-api-key') ?? req.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!header) {
      res.status(401).json({
        error: {
          code: 'MISSING_API_KEY',
          message: 'Falta el header X-API-Key.',
          docs: 'https://docs.asta.mx/api/autenticacion',
        },
      });
      return;
    }

    const result = await verifyApiKey(header, req.ip);

    if (!result.ok) {
      // Un solo mensaje para todas las causas: no se le regala al atacante un
      // oráculo que distinga "no existe" de "existe pero está revocada".
      req.log?.warn({ reason: result.reason, ip: req.ip }, 'api key rechazada');
      res.status(401).json({
        error: { code: 'INVALID_API_KEY', message: 'API key inválida o revocada.' },
      });
      return;
    }

    req.identity = result.identity;
    next();
  };
}

/** Exige uno o más scopes. Se compone después de authApiKey(). */
export function requireScope(...required: ApiScope[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const granted = new Set(req.identity?.scopes ?? []);
    const missing = required.filter((scope) => !granted.has(scope));

    if (missing.length > 0) {
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `Esta API key no tiene los permisos: ${missing.join(', ')}`,
          required,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Fuerza el aislamiento por cliente.
 *
 * Si un request trae `partner_id` en body o query, se ignora y se sobreescribe con
 * el del token. Un cliente no puede pedir datos de otro ni por accidente ni a
 * propósito: es la línea que separa "API multi-tenant" de "fuga de datos".
 */
export function scopeToOwnPartner(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const requested = req.body?.partner_id ?? req.query?.partner_id;

    if (requested !== undefined && Number(requested) !== req.identity.odooPartnerId) {
      req.log?.warn(
        { apiKeyId: req.identity.apiKeyId, requested, actual: req.identity.odooPartnerId },
        'intento de acceso cruzado entre clientes',
      );
    }

    if (req.body) req.body.partner_id = req.identity.odooPartnerId;
    req.scopedPartnerId = req.identity.odooPartnerId;
    next();
  };
}
