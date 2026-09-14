import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApiScope } from '@asta/shared-types';
import { verifyApiKey } from '../services/apiKey.service.js';
import { recordAudit } from '../services/audit.service.js';
import { auditContext } from './auditContext.js';

/**
 * Autenticación por API key para la API pública.
 *
 * El token se lee del header `X-API-Key` (o `Authorization: Bearer`). Nunca de la
 * query string: los query params acaban en logs de acceso, en el Referer y en el
 * historial de proxies.
 */
export function authApiKey(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // try/catch obligatorio: el middleware usa Express 4, que NO reenvía al
    // manejador de errores lo que lanza una función async. Sin esto, un fallo de
    // MySQL al verificar la key dejaba la petición colgada y emitía un
    // `unhandledRejection` — que en Node 24, sin un manejador global, tumba el
    // proceso entero, panel de vendedores incluido. `authJwt` y `autorizar` ya lo
    // hacían; este era el único que no, y no se notaba porque la API pública no
    // estaba montada.
    try {
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
        // Para `registroPeticiones`: a qué key iba el intento, si se sabe. Vive en
        // `res.locals`, que nunca se serializa en la respuesta.
        if (result.apiKeyId) res.locals.apiKeyIdRechazada = result.apiKeyId;
        res.status(401).json({
          error: { code: 'INVALID_API_KEY', message: 'API key inválida o revocada.' },
        });
        return;
      }

      req.identity = result.identity;
      next();
    } catch (error) {
      next(error);
    }
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
 * El `partner_id` de una petición de la API pública sale SIEMPRE de la API key.
 * Si el request trae uno —en body o en query— que no es el del propio cliente, se
 * RECHAZA con 400 y se audita. Uno que coincide con el propio se deja pasar: no
 * es un ataque, y rechazarlo rompería integraciones que lo mandan por inercia.
 *
 * ── Por qué 400 y no corregirlo en silencio ────────────────────────────────
 *
 * Había tres salidas. Corregir el body y dejar la query intacta —lo que hacía
 * antes, aunque el comentario prometía ambas— era la peor: el aislamiento
 * dependía de que cada controlador leyera `req.scopedPartnerId` y no
 * `req.query.partner_id`, y las rutas públicas son GET.
 *
 * Sobreescribir también la query es técnicamente posible en Express 4 y taparía
 * el hueco. Pero un cliente que manda el `partner_id` de OTRO está haciendo algo
 * que merece un error, no una corrección callada: con la corrección, su
 * integración "funciona" devolviéndole sus propios datos, y nadie se entera de
 * que alguien lo intentó. El 400 lo hace visible para él y el registro de
 * auditoría para nosotros.
 */
export function scopeToOwnPartner(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Sin identidad no hay nada a lo que acotar. Antes se accedia a
    // `req.identity.odooPartnerId` directamente —al contrario que
    // requireScope, que usa optional chaining— asi que montar este middleware
    // sin authApiKey() delante producia un TypeError y un 500 con traza, en vez
    // de una denegacion limpia.
    const identidad = req.identity;
    if (!identidad) {
      res.status(401).json({
        error: {
          code: 'MISSING_API_KEY',
          message: 'Falta el header X-API-Key.',
          docs: 'https://docs.asta.mx/api/autenticacion',
        },
      });
      return;
    }

    const requested = req.body?.partner_id ?? req.query?.partner_id;

    if (requested !== undefined && Number(requested) !== identidad.odooPartnerId) {
      req.log?.warn(
        { apiKeyId: identidad.apiKeyId, requested, actual: identidad.odooPartnerId },
        'intento de acceso cruzado entre clientes',
      );

      // El registro NO depende de que haya logger. `req.log?.warn` es opcional
      // —si pino-http no está montado en algún camino, no escribe nada— y #36
      // exige que cada intento quede registrado.
      recordAudit({
        action: 'access.denied.partner',
        ...auditContext(req),
        targetType: 'res.partner',
        targetId: String(requested),
        metadata: { via: 'api_key', apiKeyId: identidad.apiKeyId ?? null, path: req.path },
      });

      res.status(400).json({
        error: {
          code: 'PARTNER_ID_NOT_ALLOWED',
          message: 'partner_id no se puede elegir: se deriva de la API key.',
        },
      });
      return;
    }

    if (req.body) req.body.partner_id = identidad.odooPartnerId;
    req.scopedPartnerId = identidad.odooPartnerId;
    next();
  };
}
