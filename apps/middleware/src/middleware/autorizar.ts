import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ambitoDe, puede, type Accion } from '@asta/shared-types';
import { assertSalespersonOwnsPartner, type PartnerWithTier } from '../services/partners.service.js';
import { recordAudit } from '../services/audit.service.js';
import { auditContext } from './auditContext.js';

/**
 * Puerta ÚNICA de autorización.
 *
 * Aplica las dos mitades que la matriz declara —el rol y el ámbito— en una sola
 * llamada. Los controladores dejan de decidir sobre permisos: solo hacen su
 * trabajo.
 *
 * La diferencia práctica está en lo que pasa al añadir un endpoint. Antes había
 * que acordarse de comprobar el rol Y de llamar a `assertSalespersonOwnsPartner`;
 * ahora se declara la acción en la ruta y las dos cosas ocurren solas. No existe
 * la forma de conceder el rol y olvidar el ámbito, porque van en la misma línea
 * de la matriz.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * El partner ya verificado, cuando la acción tenía ámbito
       * `partner-propio`. El controlador lo usa sin volver a consultarlo.
       */
      partnerAutorizado?: PartnerWithTier;
    }
  }
}

function denegarPorRol(req: Request, res: Response, accion: Accion): void {
  recordAudit({
    action: 'access.denied.role',
    ...auditContext(req),
    targetType: 'accion',
    targetId: accion,
    metadata: { rol: req.identity?.role ?? null, path: req.path },
  });

  res.status(403).json({
    error: {
      code: 'ROLE_NOT_ALLOWED',
      // Se dice QUÉ acción se denegó, no qué rol haría falta: lo segundo le
      // enseña a un atacante el mapa de roles del sistema.
      message: 'Tu rol no tiene permiso para esta operación.',
    },
  });
}

export function autorizar(accion: Accion): RequestHandler {
  const ambito = ambitoDe(accion);

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.identity) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } });
      return;
    }

    if (!puede(req.identity.role, accion)) {
      denegarPorRol(req, res, accion);
      return;
    }

    if (ambito !== 'partner-propio') {
      next();
      return;
    }

    // ── Ámbito: el recurso tiene que ser suyo ───────────────────────────────
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId) || partnerId <= 0) {
      res.status(400).json({
        error: { code: 'INVALID_PARTNER_ID', message: 'partnerId inválido' },
      });
      return;
    }

    // SUPERADMIN ve cualquier cliente: no tiene cartera contra la que comprobar.
    if (req.identity.role === 'SUPERADMIN') {
      next();
      return;
    }

    if (req.identity.odooUserId === null) {
      // Un VENDEDOR sin res.users.id no puede tener cartera. Es un dato mal
      // sincronizado, no un intento de intrusión, pero el resultado es el mismo.
      denegarPorRol(req, res, accion);
      return;
    }

    try {
      // Lanza ForbiddenPartnerAccess (403) o PartnerNotFound (404); el manejador
      // de errores los traduce y registra la auditoría.
      req.partnerAutorizado = await assertSalespersonOwnsPartner(
        req.identity.odooUserId,
        partnerId,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}
