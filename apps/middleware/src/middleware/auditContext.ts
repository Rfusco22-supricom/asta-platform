import type { Request } from 'express';
import type { AuditEvent } from '../services/audit.service.js';

/**
 * Extrae del request lo que todo evento de auditoría necesita.
 *
 * Vive aquí y no en `audit.service.ts` por el mismo motivo que la augmentación
 * de Express está en su propio archivo: **un servicio no debe arrastrar la
 * infraestructura de quien lo llama**.
 *
 * Cuando esta función estaba dentro del servicio, `audit.service.ts` importaba
 * los tipos de Express, así que cualquier script de línea de comandos que
 * quisiera registrar un evento —el job de sincronización, por ejemplo— tenía
 * que conocer el tipado de un servidor HTTP que no usa para nada.
 */
export function auditContext(
  req: Request,
): Pick<AuditEvent, 'actorId' | 'actorOdooUserId' | 'ip'> {
  return {
    actorId: req.identity?.appUserId ?? null,
    actorOdooUserId: req.identity?.odooUserId ?? null,
    ip: req.ip ?? null,
  };
}
