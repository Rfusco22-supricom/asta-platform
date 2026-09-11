import { prisma } from '../config/prisma.js';
import { invalidarCacheSesion } from '../middleware/authJwt.js';
import type { SesionActiva, TipoDispositivo } from '@asta/shared-types';

/**
 * Sesiones activas (issue #52).
 *
 * Responde a "¿alguien más está dentro de mi cuenta?". Sin esta pantalla, la
 * detección de reuso de refresh tokens funciona pero es invisible: el sistema
 * revoca la familia entera y el usuario solo ve que le han echado, sin saber
 * desde dónde ni por qué.
 *
 * ── El invariante ────────────────────────────────────────────────────────────
 *
 * Un usuario solo ve y cierra SUS sesiones. Ninguna de las dos funciones acepta
 * un `sessionId` suelto: el `userId` entra siempre y forma parte del `where`.
 *
 * Esto no es celo. Si `revocarSesion` borrara por id sin comprobar el dueño,
 * cualquiera con una sesión válida podría cerrar la de otro probando UUIDs —una
 * denegación de servicio contra una cuenta ajena, servida desde el propio panel.
 * Por eso el filtro va en la consulta y no en un `if` previo: no hay forma de
 * llamar a esto y saltarse la comprobación.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Lectura del user-agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traduce el user-agent a algo que una persona reconozca.
 *
 * Deliberadamente tosco. No es identificación de dispositivos: es ayudar a que
 * alguien mire una lista y piense "esa no soy yo". Para eso basta con navegador
 * y sistema, y acertar en los casos comunes vale más que cubrir todos.
 *
 * El user-agent es un dato que manda el cliente y puede contener cualquier cosa,
 * incluido HTML. Reducirlo aquí a un conjunto cerrado de etiquetas nuestras
 * significa que la vista nunca pinta texto ajeno.
 */
export function describirDispositivo(ua: string | null): {
  dispositivo: string;
  tipo: TipoDispositivo;
} {
  if (!ua) return { dispositivo: 'Dispositivo desconocido', tipo: 'desconocido' };

  const navegador =
    // El orden importa: Edge y Opera también dicen "Chrome", y Chrome dice
    // "Safari". Mirar primero el más específico evita etiquetar mal.
    /\bEdg\//.test(ua) ? 'Edge'
    : /\bOPR\/|\bOpera/.test(ua) ? 'Opera'
    : /\bFirefox\//.test(ua) ? 'Firefox'
    : /\bChrome\//.test(ua) ? 'Chrome'
    : /\bSafari\//.test(ua) ? 'Safari'
    : null;

  const sistema =
    /\bAndroid\b/.test(ua) ? 'Android'
    : /\b(iPhone|iPad|iPod)\b/.test(ua) ? 'iOS'
    : /\bWindows\b/.test(ua) ? 'Windows'
    : /\b(Macintosh|Mac OS X)\b/.test(ua) ? 'macOS'
    : /\bLinux\b/.test(ua) ? 'Linux'
    : null;

  const tipo: TipoDispositivo =
    /\biPad\b/.test(ua) || (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua))
      ? 'tablet'
      : /\b(Mobi|iPhone|iPod|Android)\b/.test(ua)
        ? 'movil'
        : navegador || sistema
          ? 'escritorio'
          : 'desconocido';

  const dispositivo =
    navegador && sistema ? `${navegador} en ${sistema}`
    : navegador ?? sistema ?? 'Dispositivo desconocido';

  return { dispositivo, tipo };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sesiones vivas del usuario, la más recién usada primero.
 *
 * "Vivas" es: no revocada y no caducada. Las revocadas se quedan en la tabla
 * —hacen falta para la detección de reuso— pero enseñarlas aquí convertiría la
 * pantalla en un historial. Quien entra quiere saber quién está dentro AHORA;
 * una lista de treinta sesiones cerradas esconde la única que importa.
 */
export async function listarSesiones(
  userId: string,
  sesionActualId: string | undefined,
): Promise<SesionActiva[]> {
  const filas = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    // `lastUsedAt` es null hasta el primer refresh, así que se cae a `issuedAt`
    // para que una sesión recién abierta no acabe al final de la lista.
    orderBy: [{ lastUsedAt: 'desc' }, { issuedAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      userAgent: true,
      ip: true,
      issuedAt: true,
      lastUsedAt: true,
      expiresAt: true,
      // refreshTokenHash NO se selecciona. Es el único secreto de la tabla.
    },
  });

  return filas.map((f) => {
    const { dispositivo, tipo } = describirDispositivo(f.userAgent);
    return {
      id: f.id,
      dispositivo,
      tipo,
      ip: f.ip,
      iniciadaEn: f.issuedAt.toISOString(),
      ultimoUsoEn: f.lastUsedAt?.toISOString() ?? null,
      expiraEn: f.expiresAt.toISOString(),
      esActual: f.id === sesionActualId,
    };
  });
}

export class SesionNoEncontrada extends Error {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    /*
     * Mismo mensaje tanto si la sesión no existe como si es de otro usuario.
     *
     * Distinguirlos convertiría el endpoint en un oráculo: probando UUIDs se
     * podría averiguar cuáles corresponden a sesiones reales de otras cuentas.
     * No hay nada que ganar siendo más específico — al dueño legítimo le da
     * igual el matiz, porque su sesión sí aparece en su lista.
     */
    super('Esa sesión no existe o ya está cerrada.');
    this.name = 'SesionNoEncontrada';
  }
}

/**
 * Cierra UNA sesión del usuario.
 *
 * El `userId` va dentro del `where`: una sesión de otra cuenta simplemente no
 * se encuentra. No hay camino que llegue al `update` sin haber comprobado el
 * dueño.
 */
export async function revocarSesion(
  userId: string,
  sessionId: string,
): Promise<void> {
  const r = await prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'logout' },
  });

  if (r.count === 0) throw new SesionNoEncontrada();

  /*
   * Sin esto, cerrar una sesión no surte efecto hasta 5 segundos después.
   *
   * `authJwt` cachea la identidad por id de sesión para no golpear MySQL en cada
   * request. Es una ventana pequeña, pero quien cierra la sesión de un intruso
   * está haciendo justo lo contrario de esperar.
   */
  invalidarCacheSesion(sessionId);
}

/**
 * Cierra todas MENOS la actual.
 *
 * Es la acción que de verdad se quiere cuando algo no cuadra: echar a todos los
 * demás sin echarse uno mismo a mitad de la operación. Cerrar también la propia
 * ya existe y se llama cerrar sesión.
 */
export async function revocarLasDemas(
  userId: string,
  sesionActualId: string | undefined,
): Promise<number> {
  const objetivo = await prisma.userSession.findMany({
    where: {
      userId,
      revokedAt: null,
      ...(sesionActualId ? { id: { not: sesionActualId } } : {}),
    },
    select: { id: true },
  });

  if (objetivo.length === 0) return 0;

  const r = await prisma.userSession.updateMany({
    where: { id: { in: objetivo.map((s) => s.id) } },
    data: { revokedAt: new Date(), revokedReason: 'logout' },
  });

  for (const s of objetivo) invalidarCacheSesion(s.id);

  return r.count;
}
