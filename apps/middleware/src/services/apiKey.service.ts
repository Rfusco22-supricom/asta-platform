import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ApiScope,
  ApiKeyEnv,
  ApiKeySummary,
  ApiKeyUsageRow,
  ErrorCode,
} from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { origenPermitido } from './ipAllowlist.js';

/**
 * Emisión y verificación de API keys de cliente.
 *
 * Formato:  asta_live_<prefix>_<secret>
 *           └ marca ┘└env┘└ 8 hex ┘└ 43 chars base64url = 32 bytes ┘
 *
 * Por qué así:
 *
 * · El prefijo va en claro e indexado -> encontrar la fila es un índice único,
 *   no un table scan hasheando fila por fila.
 * · El hash es HMAC-SHA256 con un pepper de entorno, no bcrypt. bcrypt cuesta
 *   ~100 ms; a 60 req/min por key eso es tiempo de CPU regalado. Un KDF lento
 *   protege secretos de baja entropía (contraseñas humanas); aquí el secreto son
 *   32 bytes de CSPRNG: no hay diccionario que atacar.
 * · El pepper vive en el entorno y no en la BD: una exfiltración de `api_keys`
 *   no alcanza para verificar un solo token.
 * · El prefijo con marca visible (`asta_live_`) permite que los escáneres de
 *   secretos de GitHub lo detecten cuando un cliente lo suba a un repo público.
 */

const TOKEN_REGEX = /^asta_(live|test)_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export interface IssuedApiKey {
  id: string;
  /** El token completo. Se devuelve UNA vez y no se puede recuperar después. */
  plaintext: string;
  prefix: string;
  lastFour: string;
  scopes: ApiScope[];
  expiresAt: Date | null;
}

function hmac(pepper: string, token: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

function hashToken(token: string): string {
  return hmac(env().API_KEY_PEPPER, token);
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function issueApiKey(params: {
  userId: string;
  name: string;
  scopes: ApiScope[];
  environment?: ApiKeyEnv;
  expiresInDays?: number;
  rateLimitPerMinute?: number;
  createdFromIp?: string;
}): Promise<IssuedApiKey> {
  if (params.scopes.length === 0) {
    throw new Error('Una API key debe nacer con al menos un scope explícito');
  }

  const environment = params.environment ?? 'LIVE';
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `asta_${environment.toLowerCase()}_${prefix}_${secret}`;

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 86_400_000)
    : null;

  const record = await prisma.apiKey.create({
    data: {
      userId: params.userId,
      name: params.name,
      environment,
      prefix,
      keyHash: hashToken(plaintext),
      lastFour: secret.slice(-4),
      // MySQL no tiene arrays: los scopes viven en tabla puente y se insertan
      // en la misma transacción implícita que la key. Una key nunca existe sin
      // sus permisos.
      scopes: { create: params.scopes.map((scope) => ({ scope })) },
      rateLimitPerMinute: params.rateLimitPerMinute ?? 60,
      expiresAt,
      createdFrom: params.createdFromIp,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: params.userId,
      action: 'api_key.created',
      targetType: 'ApiKey',
      targetId: record.id,
      metadata: { name: params.name, scopes: params.scopes, environment, expiresAt },
      ip: params.createdFromIp,
    },
  });

  return {
    id: record.id,
    plaintext,
    prefix,
    lastFour: secret.slice(-4),
    scopes: params.scopes,
    expiresAt,
  };
}

export type VerifyFailure =
  | 'MALFORMED'
  | 'NOT_FOUND'
  | 'REVOKED'
  | 'EXPIRED'
  | 'USER_INACTIVE'
  | 'IP_NOT_ALLOWED';

export interface VerifiedIdentity {
  apiKeyId: string;
  appUserId: string;
  role: 'SUPERADMIN' | 'VENDEDOR' | 'BRONCE' | 'PLATA' | 'GOLD';
  odooPartnerId: number;
  odooUserId: number | null;
  odooPricelistId: number | null;
  scopes: ApiScope[];
  rateLimitPerMinute: number;
}

export type VerifyResult =
  | { ok: true; identity: VerifiedIdentity }
  | {
      ok: false;
      reason: VerifyFailure;
      /**
       * La key a la que iba dirigido el intento, cuando se puede saber: siempre
       * que el PREFIJO corresponde a una key real, aunque luego falle el secreto,
       * esté revocada, caducada o fuera de su lista de IPs.
       *
       * Solo para el registro (`api_request_logs`), nunca para la respuesta: hacia
       * fuera sigue saliendo el mismo 401 para todo. Sin esto, la alerta `key-401`
       * de #46 no podía atribuir un rechazo a ninguna key y no saltaba nunca. Y es
       * justo lo que distingue "una integración con una key revocada" de "alguien
       * que conoce el prefijo de una key y está probando secretos".
       */
      apiKeyId?: string;
    };

/**
 * Verifica un token. Coste: un índice único + un HMAC. Sin RPC a Odoo.
 *
 * El motivo de devolver siempre el mismo 401 hacia afuera (y el detalle solo por
 * log) es no darle al atacante un oráculo que distinga "esta key no existe" de
 * "esta key existe pero expiró".
 */
export async function verifyApiKey(rawToken: string, ip?: string): Promise<VerifyResult> {
  // Se recorta UNA vez y se usa ese valor para todo. Antes el formato se
  // validaba sobre `rawToken.trim()` pero el HMAC se calculaba sobre `rawToken`:
  // una key valida copiada con un salto de linea —al pegarla en un .env o en un
  // curl— pasaba el formato, fallaba el hash, y se rechazaba como NOT_FOUND,
  // indistinguible de una key inventada.
  const token = rawToken.trim();

  const match = TOKEN_REGEX.exec(token);
  if (!match) return { ok: false, reason: 'MALFORMED' };

  const [, , prefix] = match;

  // Un solo round-trip: la key, su dueño, sus scopes y su lista blanca.
  // Los dos `include` de abajo son el coste de que MySQL no tenga arrays —dos
  // JOIN sobre índices de clave primaria— y es lo que se paga a cambio de que
  // el motor impida guardar un scope inventado.
  const key = await prisma.apiKey.findUnique({
    where: { prefix },
    include: {
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
      scopes: { select: { scope: true } },
      allowedIps: { select: { cidr: true } },
    },
  });

  // Se calcula el HMAC aunque la fila no exista, para que el tiempo de respuesta
  // no revele si el prefijo es válido.
  const stored = key?.keyHash ?? '0'.repeat(64);
  const conActual = iguales(hashToken(token), stored);

  // Rotación del pepper (#45). Con un pepper anterior configurado se calculan
  // SIEMPRE los dos HMAC, coincida o no el primero: así el tiempo tampoco dice
  // con qué pepper está hasheada la key.
  const anterior = env().API_KEY_PEPPER_ANTERIOR;
  const conAnterior = anterior !== undefined && iguales(hmac(anterior, token), stored);
  const hashMatches = conActual || conAnterior;

  if (!key) return { ok: false, reason: 'NOT_FOUND' };

  // El token en claro solo existe aquí, en el momento de verificar: es la única
  // ocasión de pasar la key al pepper actual sin pedirle nada al cliente.
  // Se hace aunque luego la key resulte revocada o caducada: el secreto ya está
  // demostrado, y así la ventana de rotación no depende del estado de cada key.
  if (conAnterior && !conActual) {
    try {
      // `keyHash` en el where: si dos peticiones concurrentes migran la misma
      // key, la segunda no encuentra la fila vieja y no hace nada.
      await prisma.apiKey.updateMany({
        where: { id: key.id, keyHash: key.keyHash },
        data: { keyHash: hashToken(token) },
      });
    } catch {
      // Si falla, la key sigue funcionando con el pepper anterior mientras dure
      // la ventana, y se reintentará en el próximo uso. No se tumba la petición.
    }
  }
  // Prefijo real, secreto equivocado: hacia fuera es indistinguible de una key
  // inexistente, pero el intento iba contra ESTA key y así se registra.
  if (!hashMatches) return { ok: false, reason: 'NOT_FOUND', apiKeyId: key.id };
  if (key.revokedAt) return { ok: false, reason: 'REVOKED', apiKeyId: key.id };
  if (key.expiresAt && key.expiresAt < new Date()) {
    return { ok: false, reason: 'EXPIRED', apiKeyId: key.id };
  }
  if (!key.user.isActive) return { ok: false, reason: 'USER_INACTIVE', apiKeyId: key.id };
  const allowedIps = key.allowedIps.map((row) => row.cidr);
  if (!origenPermitido(allowedIps, ip)) {
    return { ok: false, reason: 'IP_NOT_ALLOWED', apiKeyId: key.id };
  }

  // `lastUsedAt` se actualiza fuera del camino crítico: no se espera al INSERT
  // para responderle al cliente.
  void prisma.apiKey
    .update({
      where: { id: key.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ip, usageCount: { increment: 1 } },
    })
    .catch(() => {
      /* la telemetría nunca debe tumbar un request */
    });

  return {
    ok: true,
    identity: {
      apiKeyId: key.id,
      appUserId: key.user.id,
      role: key.user.role,
      odooPartnerId: key.user.odooPartnerId,
      odooUserId: key.user.odooUserId,
      odooPricelistId: key.user.odooPricelistId,
      scopes: key.scopes.map((row) => row.scope),
      rateLimitPerMinute: key.rateLimitPerMinute,
    },
  };
}

export class ApiKeyNoEncontrada extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'NOT_FOUND';

  constructor(apiKeyId: string) {
    // MISMO mensaje tanto si la key no existe como si es de otro. Distinguirlos
    // convertiría este endpoint en un oráculo: probando ids se sabría cuáles
    // están en uso por otros clientes.
    super('Esa API key no existe o no es tuya.');
    this.name = 'ApiKeyNoEncontrada';
    void apiKeyId;
  }
}

/**
 * Revoca una key.
 *
 * ── `duenoEsperado` es obligatorio y no tiene valor por defecto ──────────────
 *
 * Esta función NO comprobaba de quién era la key: revocaba por id, sin más.
 * Mientras solo la llamaban los tests daba igual. En cuanto la UI de #28 la
 * expone a un cliente, «revocar por id» significa que cualquiera con una cuenta
 * puede apagar la integración de otro mandando un uuid — sin leer nada suyo, así
 * que ni el aislamiento de lectura lo habría frenado.
 *
 * El parámetro no lleva defecto a propósito. Pasar `null` —el caso peligroso, el
 * del SUPERADMIN que revoca la de cualquiera— hay que ESCRIBIRLO en la ruta, y
 * entonces se ve al revisarla. Un `duenoEsperado?: string` opcional habría dejado
 * que el camino inseguro fuera el de omitir el argumento.
 */
export async function revokeApiKey(params: {
  apiKeyId: string;
  actorId: string;
  /** El dueño que debe tener la key, o `null` para no comprobarlo (SUPERADMIN). */
  duenoEsperado: string | null;
  reason?: string;
}): Promise<void> {
  const { apiKeyId, actorId, duenoEsperado, reason } = params;

  if (duenoEsperado !== null) {
    const suya = await prisma.apiKey.findFirst({
      // El userId va DENTRO del where, no en un `if` después de leer: es la
      // misma regla que las sesiones de #52.
      where: { id: apiKeyId, userId: duenoEsperado },
      select: { id: true },
    });
    if (!suya) throw new ApiKeyNoEncontrada(apiKeyId);
  }

  await prisma.$transaction([
    prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date(), revokedById: actorId, revokeReason: reason },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'api_key.revoked',
        targetType: 'ApiKey',
        targetId: apiKeyId,
        metadata: { reason: reason ?? null, propia: duenoEsperado !== null },
      },
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que consume la UI del cliente (#28)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las keys de UN usuario, revocadas incluidas.
 *
 * Las revocadas NO se ocultan. Quien entra a esta pantalla suele venir de
 * «¿alguien está usando algo mío?», y una lista que solo enseña lo vivo no
 * responde a eso: no deja ver que ayer se apagó una integración, ni cuándo se
 * usó por última vez. Se devuelven marcadas y la UI las separa.
 */
export async function listarApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const filas = await prisma.apiKey.findMany({
    where: { userId },
    include: { scopes: { select: { scope: true } } },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
  });

  return filas.map((k) => ({
    id: k.id,
    name: k.name,
    environment: k.environment,
    prefix: k.prefix,
    lastFour: k.lastFour,
    scopes: k.scopes.map((s) => s.scope),
    rateLimitPerMinute: k.rateLimitPerMinute,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    /*
     * `usage_count` es BIGINT y Prisma lo devuelve como `bigint` de JavaScript,
     * que `JSON.stringify` NO sabe serializar: lanza «Do not know how to
     * serialize a BigInt» y el endpoint entero responde 500.
     *
     * No es un caso raro que aparecerá en producción con el tiempo: pasa con
     * CUALQUIER valor, incluido el 0 de una key recién creada.
     */
    usageCount: Number(k.usageCount),
  }));
}

/**
 * Últimas peticiones hechas con una key.
 *
 * El `userId` no se usa para filtrar el log —`api_request_logs` no tiene clave
 * foránea a `api_keys`, a propósito, porque la tabla se particiona— sino para
 * comprobar ANTES que la key es de quien pregunta. Sin ese paso, pasar un uuid
 * ajeno enseñaría por dónde se mueve la integración de otro cliente: sus rutas,
 * sus horarios y su volumen.
 */
export async function usosDeApiKey(
  userId: string,
  apiKeyId: string,
  limite = 20,
): Promise<ApiKeyUsageRow[]> {
  const suya = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
    select: { id: true },
  });
  if (!suya) throw new ApiKeyNoEncontrada(apiKeyId);

  const filas = await prisma.apiRequestLog.findMany({
    where: { apiKeyId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limite, 1), 100),
    select: {
      method: true,
      path: true,
      statusCode: true,
      durationMs: true,
      cacheHit: true,
      createdAt: true,
    },
  });

  return filas.map((f) => ({
    method: f.method,
    path: f.path,
    statusCode: f.statusCode,
    durationMs: f.durationMs,
    cacheHit: f.cacheHit,
    createdAt: f.createdAt.toISOString(),
  }));
}

/**
 * ¿Sigue valiendo la key con la que se emitió un enlace de descarga? (#32)
 *
 * La descarga no lleva la key —la autoriza la firma—, así que sin esta
 * comprobación revocar una key filtrada no cortaría los enlaces que ya emitió.
 * Duran 5 minutos, pero son 5 minutos de facturas.
 *
 * Mismas condiciones que `verifyApiKey` salvo la lista de IPs: el enlace existe
 * precisamente para abrirse desde otro sitio —un navegador, contabilidad—. Se
 * emitió desde una IP permitida, y eso ya lo comprobó `verifyApiKey`.
 *
 * Además la key tiene que seguir siendo del mismo cliente y conservar
 * `INVOICES_READ`: quitarle el scope también corta sus enlaces.
 */
export async function keyVigenteParaEnlace(apiKeyId: string, partnerId: number): Promise<boolean> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      revokedAt: true,
      expiresAt: true,
      user: { select: { isActive: true, odooPartnerId: true } },
      scopes: { select: { scope: true } },
    },
  });
  if (!key || key.revokedAt) return false;
  if (key.expiresAt && key.expiresAt < new Date()) return false;
  if (!key.user.isActive || key.user.odooPartnerId !== partnerId) return false;
  return key.scopes.some((s) => s.scope === 'INVOICES_READ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotación del pepper (#45)
// ─────────────────────────────────────────────────────────────────────────────

export interface KeyPendienteDeRotacion {
  id: string;
  name: string;
  /** `asta_live_<prefix>…<lastFour>`, exactamente como lo muestra «Mis API keys». */
  identificador: string;
  creadaEn: Date;
  ultimoUso: Date | null;
  email: string;
  nombre: string;
}

/**
 * Keys activas que todavía no han pasado al pepper actual.
 *
 * Una key migra en su primer uso con éxito tras la rotación (`verifyApiKey`).
 * Así que siguen pendientes las que ya existían al rotar y no se han usado
 * desde entonces. Son las que dejarán de funcionar al quitar
 * `API_KEY_PEPPER_ANTERIOR`, y a sus dueños —solo a ellos— hay que avisar.
 *
 * No hace falta una columna con la versión del pepper: basta con la fecha en que
 * se desplegó la rotación, que el runbook pide anotar.
 *
 * Puede dar algún falso positivo, nunca un falso negativo que importe: una key
 * que migró pero cuyo uso se rechazó después (por ejemplo, desde una IP no
 * permitida) no actualiza `last_used_at` y sale como pendiente. Avisar de más a
 * ese cliente no rompe nada.
 */
export async function keysPendientesDeRotacion(desde: Date): Promise<KeyPendienteDeRotacion[]> {
  const ahora = new Date();
  const filas = await prisma.apiKey.findMany({
    where: {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: ahora } }],
      createdAt: { lt: desde },
      AND: [{ OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: desde } }] }],
    },
    include: { user: { select: { email: true, fullName: true } } },
    orderBy: [{ user: { email: 'asc' } }, { createdAt: 'asc' }],
  });

  return filas.map((k) => ({
    id: k.id,
    name: k.name,
    identificador: `asta_${k.environment.toLowerCase()}_${k.prefix}…${k.lastFour}`,
    creadaEn: k.createdAt,
    ultimoUso: k.lastUsedAt,
    email: k.user.email,
    nombre: k.user.fullName,
  }));
}
