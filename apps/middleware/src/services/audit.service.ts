import { prisma } from '../config/prisma.js';

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
 * Dos sinks en paralelo: uno escribe JSON a stdout (para el agregador de logs y
 * las alertas de #46) y otro a la tabla `audit_logs`.
 *
 * Separarlos no es arquitectura de más. Permite que los tests de #25 comprueben
 * que el evento SE EMITE sin levantar una base de datos, y que el rastro
 * sobreviva si uno de los dos destinos falla.
 */

export type AuditAction =
  | 'access.denied.partner'
  | 'access.denied.role'
  | 'access.denied.auth'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'user.role_changed'
  | 'sync.partners'
  /// Alta de una cuenta de VENDEDOR desde Odoo (#81). Va aparte de
  /// `sync.partners` porque no es lo mismo copiar un cliente que conceder
  /// acceso a la facturación de una cartera entera.
  | 'sync.vendedores'
  | 'user.invitado'
  | 'user.invitacion_aceptada';

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

let dbSinkInstalado = false;

/**
 * Sink que escribe en `audit_logs`.
 *
 * Se instala aparte del de log porque necesita la base, y hay contextos —tests
 * unitarios, el `odoo-probe`— donde no la hay. Separarlos permite que la
 * auditoría funcione igual en los dos.
 *
 * La escritura va FUERA del camino crítico: el request no espera al INSERT.
 * Igual que `lastUsedAt` de las API keys, el rastro no puede añadir latencia ni,
 * mucho menos, tumbar la petición que lo originó.
 *
 * CONTRAPARTIDA ASUMIDA: si el proceso muere entre la respuesta y el INSERT, ese
 * evento se pierde. Por eso el sink de log sigue instalado en paralelo — son dos
 * destinos independientes, y que fallen a la vez es mucho menos probable.
 */
export function installDbAuditSink(): void {
  if (dbSinkInstalado) return;
  dbSinkInstalado = true;

  registerAuditSink((e) => {
    void prisma.auditLog
      .create({
        data: {
          actorId: e.actorId,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          // El JSON de Prisma no admite `undefined`.
          metadata: (e.metadata ?? null) as never,
          ip: e.ip,
          createdAt: e.at,
        },
      })
      .catch((err) => {
        // Un fallo escribiendo auditoría NO puede romper nada, pero tampoco
        // puede desaparecer en silencio: quedaría un hueco en el rastro sin que
        // nadie se entere. Se grita por stderr.
        process.stderr.write(
          JSON.stringify({
            level: 'error',
            msg: 'no se pudo persistir un evento de auditoria',
            action: e.action,
            err: err instanceof Error ? err.message : String(err),
          }) + '\n',
        );
      });
  });
}
