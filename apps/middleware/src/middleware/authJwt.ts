import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Identity } from '@asta/shared-types';
import { bearerDe, TokenInvalido, verificarAccessToken } from '../auth/jwt.js';
import { prisma } from '../config/prisma.js';
import { recordAudit } from '../services/audit.service.js';

/**
 * Autenticación por JWT. Sustituye a `authDev()`.
 *
 * Produce el MISMO `req.identity` que `authApiKey()`, para que los controladores
 * no tengan que saber por qué puerta entró el request.
 *
 * ── Por qué consulta la base y no se fía solo del token ──────────────────────
 *
 * El JWT ya lleva rol y partner dentro y está firmado, así que sería más rápido
 * confiar en él sin más. No se hace, por dos motivos:
 *
 *   · La sesión puede haberse revocado (logout, cambio de contraseña, reuso de
 *     refresh token detectado). El access token seguiría siendo válido hasta 15
 *     minutos. Comprobar `user_sessions` cierra esa ventana.
 *   · El rol puede haber cambiado. Sin RLS detrás (#44), un rol obsoleto en el
 *     token es la diferencia entre ver tu cartera y ver la de todos.
 *
 * El coste es una consulta por índice primario, cacheada unos segundos. Barato
 * comparado con lo que evita.
 */

interface Entrada {
  identity: Identity;
  expiraEn: number;
}

/**
 * Cache muy corta (5 s) por id de sesión.
 *
 * No es por rendimiento de base de datos, sino porque una sola pantalla del
 * panel dispara varias llamadas casi simultáneas y no tiene sentido repetir la
 * misma consulta cuatro veces en el mismo segundo. Cinco segundos es lo bastante
 * corto para que una revocación se note enseguida.
 */
const cache = new Map<string, Entrada>();
const TTL_MS = 5_000;

export function invalidarCacheSesion(sid: string): void {
  cache.delete(sid);
}

function rechazar(res: Response, code: 'UNAUTHENTICATED' | 'TOKEN_EXPIRED', mensaje: string): void {
  res.status(401).json({ error: { code, message: mensaje } });
}

export function authJwt(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerDe(req.get('authorization'));

    if (!token) {
      rechazar(res, 'UNAUTHENTICATED', 'Falta la cabecera Authorization: Bearer.');
      return;
    }

    let claims;
    try {
      claims = await verificarAccessToken(token);
    } catch (error) {
      if (error instanceof TokenInvalido && error.motivo === 'expirado') {
        // 'TOKEN_EXPIRED' y no 'UNAUTHENTICATED': el cliente debe distinguir
        // "renueva con el refresh token" de "vuelve a iniciar sesión".
        rechazar(res, 'TOKEN_EXPIRED', 'La sesión caducó. Renuévala.');
        return;
      }
      // Una firma inválida es un intento de manipulación, no un despiste.
      if (error instanceof TokenInvalido && error.motivo === 'firma') {
        recordAudit({
          action: 'access.denied.auth',
          actorId: null,
          actorOdooUserId: null,
          targetType: 'jwt',
          targetId: null,
          ip: req.ip ?? null,
          metadata: { motivo: 'firma_invalida', path: req.path },
        });
      }
      rechazar(res, 'UNAUTHENTICATED', 'Token no válido.');
      return;
    }

    const cacheado = cache.get(claims.sid);
    if (cacheado && cacheado.expiraEn > Date.now()) {
      req.identity = cacheado.identity;
      next();
      return;
    }

    try {
      const sesion = await prisma.userSession.findUnique({
        where: { id: claims.sid },
        select: {
          revokedAt: true,
          expiresAt: true,
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
        },
      });

      if (!sesion || sesion.revokedAt || sesion.expiresAt <= new Date()) {
        cache.delete(claims.sid);
        rechazar(res, 'UNAUTHENTICATED', 'Sesión cerrada. Vuelve a iniciar sesión.');
        return;
      }

      if (!sesion.user.isActive) {
        cache.delete(claims.sid);
        rechazar(res, 'UNAUTHENTICATED', 'Cuenta desactivada.');
        return;
      }

      // El rol sale de la BASE, no del token: si cambió, manda el actual.
      const identity: Identity = {
        appUserId: sesion.user.id,
        role: sesion.user.role,
        odooPartnerId: sesion.user.odooPartnerId,
        odooUserId: sesion.user.odooUserId,
        odooPricelistId: sesion.user.odooPricelistId,
        scopes: [],
      };

      cache.set(claims.sid, { identity, expiraEn: Date.now() + TTL_MS });
      req.identity = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}
