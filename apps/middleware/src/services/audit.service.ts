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
  /// Una cuenta se apaga porque Odoo dice que esa persona está de baja (#89).
  /// Va aparte de `user.role_changed` porque no es un cambio de permisos: es
  /// retirar el acceso entero, y es lo primero que se mira cuando alguien
  /// pregunta por qué no puede entrar.
  | 'user.desactivado'
  /// Una persona valida, rechaza o devuelve a pendiente compatibilidades
  /// producto → cartucho (#56). Lo validado llega al cliente por el
  /// recomendador: si un día sale un tóner equivocado, aquí está quién y cuándo.
  | 'compatibilidad.revisada'
  | 'cartucho.tipo_corregido'
  /// Alguien añadió una compatibilidad impresora ↔ cartucho desde el panel. El
  /// estado con que nació (VALIDADA si fue un admin, PROPUESTA si fue un
  /// vendedor) va en los metadatos.
  | 'compatibilidad.anadida'
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
/**
 * Escrituras en vuelo, para poder esperarlas antes de salir.
 *
 * Ver `esperarAuditoriaPendiente()`. En el servidor no hace falta —el proceso
 * sigue vivo— pero en un CLI sí: sin esto, cada INSERT se corta al llegar el
 * `$disconnect()` de la línea siguiente.
 */
const enVuelo = new Set<Promise<unknown>>();

/**
 * Espera a que terminen los INSERT de auditoría pendientes.
 *
 * Lo llama todo proceso que se va a morir enseguida, es decir los CLI. No falla
 * nunca: los errores los grita el propio sink por stderr.
 *
 * Hizo falta porque la auditoría de los CLI se perdía ENTERA, en dos pasos: los
 * sinks solo se instalaban dentro de `createApp()` —que un CLI no llama— y, una
 * vez instalados, el `void` del INSERT dejaba la escritura a medias cuando el
 * proceso cerraba la conexión. Se descubrió al comprobar el rastro de #89 y
 * encontrar la tabla vacía; mirando hacia atrás, las 19 altas de vendedor de #81
 * tampoco habían quedado registradas.
 */
export async function esperarAuditoriaPendiente(): Promise<void> {
  await Promise.allSettled([...enVuelo]);
}

/** Instala los dos sinks. Lo llaman el servidor y cada CLI. */
export function installAuditSinks(): void {
  installLogAuditSink();
  installDbAuditSink();
}

export function installDbAuditSink(): void {
  if (dbSinkInstalado) return;
  dbSinkInstalado = true;

  registerAuditSink((e) => {
    const escritura = prisma.auditLog
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

    // Se registra para poder esperarla, y se descuenta al terminar para que el
    // conjunto no crezca con cada evento en un proceso de vida larga.
    enVuelo.add(escritura);
    void escritura.finally(() => enVuelo.delete(escritura));
  });
}
