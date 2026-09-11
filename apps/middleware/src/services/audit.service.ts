import type { Request } from 'express';

/**
 * Registro de acciones sensibles.
 *
 * ── Por qué existe como módulo y no como una línea de log ────────────────────
 *
 * Un `log.warn()` dentro del manejador de errores sirve para depurar, pero no es
 * un rastro auditable: nadie lo consulta, no tiene forma estable y se pierde
 * cuando rotan los ficheros.
 *
 * Al salir de Supabase desapareció el RLS, así que el aislamiento entre clientes
 * depende **solo** del scoping del middleware (ver #44). Cuando la única defensa
 * es el código, saber que alguien intentó saltársela deja de ser un detalle:
 * es la señal de que hay un bug o alguien probando.
 *
 * ── Estado ───────────────────────────────────────────────────────────────────
 *
 * Hoy emite el evento a los sinks registrados. El sink de Postgres/MySQL
 * (`audit_logs`) se conecta cuando exista la base (#12). La separación en sinks
 * no es arquitectura de más: es lo que permite que los tests de #25 comprueben
 * que el evento SE EMITE, sin depender de una base de datos.
 */

export type AuditAction =
  | 'access.denied.partner'
  | 'access.denied.role'
  | 'access.denied.auth'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'user.role_changed';

export interface AuditEvent {
  action: AuditAction;
  /** Quién lo intentó. Null si ni siquiera estaba autenticado. */
  actorId: string | null;
  actorOdooUserId: number | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata?: Record<string, unknown>;
  at: Date;
}

export type AuditSink = (event: AuditEvent) => void;

const sinks: AuditSink[] = [];

export function registerAuditSink(sink: AuditSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

/**
 * Emite un evento de auditoría.
 *
 * Nunca lanza: un fallo escribiendo el rastro no puede tumbar el request que lo
 * originó. Se traga el error y sigue — pero el request original ya devolvió su
 * 403, que es lo que importa para el usuario.
 */
export function recordAudit(event: Omit<AuditEvent, 'at'>): void {
  const completo: AuditEvent = { ...event, at: new Date() };
  for (const sink of sinks) {
    try {
      sink(completo);
    } catch {
      /* un sink roto no puede afectar al request */
    }
  }
}

/** Extrae del request lo que todo evento necesita. */
export function auditContext(req: Request): Pick<AuditEvent, 'actorId' | 'actorOdooUserId' | 'ip'> {
  return {
    actorId: req.identity?.appUserId ?? null,
    actorOdooUserId: req.identity?.odooUserId ?? null,
    ip: req.ip ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sink por defecto: log estructurado
// ─────────────────────────────────────────────────────────────────────────────

let logSinkInstalado = false;

/**
 * Sink que escribe a stdout en JSON.
 *
 * Es el mínimo viable mientras no haya base de datos: al menos queda en el
 * agregador de logs y se puede alertar sobre él (#46).
 */
export function installLogAuditSink(): void {
  if (logSinkInstalado) return;
  logSinkInstalado = true;

  registerAuditSink((e) => {
    // `audit` como marcador fijo para poder filtrar y alertar sobre esta línea
    // sin depender del texto del mensaje.
    process.stdout.write(
      JSON.stringify({
        audit: true,
        action: e.action,
        actorOdooUserId: e.actorOdooUserId,
        targetType: e.targetType,
        targetId: e.targetId,
        ip: e.ip,
        ...e.metadata,
        at: e.at.toISOString(),
      }) + '\n',
    );
  });
}

/**
 * PENDIENTE (#12): sink que escribe en la tabla `audit_logs`.
 *
 * Cuando MySQL esté montado:
 *
 *   registerAuditSink((e) => {
 *     void prisma.auditLog.create({ data: { ... } }).catch(() => {});
 *   });
 *
 * Fuera del camino crítico —igual que `lastUsedAt` de las API keys— porque el
 * rastro no debe añadir latencia a la respuesta.
 */
