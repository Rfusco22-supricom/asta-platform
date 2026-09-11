import type { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';
import { HTTP_STATUS_BY_ERROR, type ErrorCode } from '@asta/shared-types';
import { OdooError } from '../odoo/client.js';
import { recordAudit } from '../services/audit.service.js';
import { auditContext } from './auditContext.js';

/**
 * Manejador de errores único.
 *
 * Existe para que ningún controlador tenga que elegir su propio código HTTP ni
 * inventar la forma del JSON de error. Cuando cada endpoint decide por su
 * cuenta, el frontend acaba con un `if` distinto por pantalla.
 *
 * Regla de oro: **hacia fuera nunca sale un detalle interno.** El mensaje de
 * Odoo, el SQL, el stack — todo eso va al log, nunca al cliente. Un error
 * filtrado es información gratis sobre cómo está construido el sistema.
 */

/** Errores de servicio que ya traen su propio código y status. */
interface TypedServiceError extends Error {
  status: number;
  code: ErrorCode;
}

function isTypedServiceError(e: unknown): e is TypedServiceError {
  return (
    e instanceof Error &&
    typeof (e as TypedServiceError).status === 'number' &&
    typeof (e as TypedServiceError).code === 'string'
  );
}

function send(res: Response, code: ErrorCode, message: string, extra?: Record<string, unknown>): void {
  res.status(HTTP_STATUS_BY_ERROR[code]).json({ error: { code, message, ...extra } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Si ya se empezó a escribir la respuesta, no se puede cambiar el status.
  if (res.headersSent) return;

  // ── Errores de servicio con código propio ────────────────────────────────
  // ForbiddenPartnerAccess, PartnerNotFound y similares. Su mensaje SÍ es apto
  // para el cliente: se escribió pensando en eso.
  if (isTypedServiceError(err)) {
    // Sin RLS, este rastro es la unica forma de enterarse de que alguien
    // intento cruzar la linea. Ver #44.
    if (err.code === 'PARTNER_NOT_IN_PORTFOLIO') {
      recordAudit({
        action: 'access.denied.partner',
        ...auditContext(req),
        targetType: 'res.partner',
        targetId: String((err as { partnerId?: number }).partnerId ?? req.params.partnerId ?? ''),
        metadata: { path: req.path, motivo: err.message },
      });
    }
    send(res, err.code, err.message);
    return;
  }

  // ── Validación ───────────────────────────────────────────────────────────
  if (err instanceof ZodError) {
    send(res, 'VALIDATION_ERROR', z.prettifyError(err));
    return;
  }

  // ── Odoo caído o rechazando ──────────────────────────────────────────────
  // 503 y no 500: no es un fallo del middleware, es una dependencia externa.
  // La distinción importa para las alertas y para lo que el panel le dice al
  // usuario ("el ERP no responde" != "algo se rompió").
  if (err instanceof OdooError) {
    req.log?.error({ model: err.model, method: err.method, err: err.message }, 'fallo de Odoo');
    send(res, 'ODOO_UNAVAILABLE', 'El ERP no está respondiendo. Inténtalo en unos minutos.');
    return;
  }

  // ── Lo que no se esperaba ────────────────────────────────────────────────
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  req.log?.error({ err: detail, path: req.path }, 'error no controlado');
  send(res, 'INTERNAL_ERROR', 'Error interno.');
}

/** 404 para rutas que no existen, con la misma forma que el resto. */
export function notFoundHandler(req: Request, res: Response): void {
  send(res, 'NOT_FOUND', `No existe la ruta ${req.method} ${req.path}`);
}
