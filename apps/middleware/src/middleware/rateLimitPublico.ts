import type { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Rate limiting de la API pública (#29).
 *
 * Detrás de cada `GET /invoices` hay al menos un RPC contra Odoo, y Odoo no es un
 * servicio de repuesto: es el ERP con el que factura la empresa. Una integración
 * con un reintento en bucle, o una key filtrada, puede degradar la facturación
 * para todo el mundo. Sin límite, además, probar keys al azar sale gratis.
 *
 * Son DOS limitadores, y los dos hacen falta:
 *
 *   · `porKey`, después de autenticar. Es el límite de verdad, y va por
 *     `api_key_id` y no por IP: una integración servidor a servidor sale siempre
 *     de la misma IP corporativa, así que limitar por IP castiga a todos los que
 *     comparten salida y no distingue al que abusa. La key es la identidad real.
 *
 *   · `preAuth`, antes de autenticar. `porKey` no puede ver las peticiones con
 *     keys inválidas —no hay key que contar—, así que cada intento ya habría
 *     pagado la verificación contra la base antes de ser contado. Este cuenta por
 *     IP, pero SOLO los 401: el tráfico correcto de una IP compartida no suma.
 *
 * ── Un coste inherente de `preAuth` ─────────────────────────────────────────
 *
 * Va antes de verificar la key, así que no puede saber si es buena. Una IP que
 * acumula demasiados 401 recibe 429 también en sus peticiones CORRECTAS hasta que
 * pasa la ventana. Comprobado. Por eso el umbral es generoso: solo se alcanza con
 * un volumen de fallos que ninguna integración sana produce.
 *
 * Depende además de `trust proxy` (#52, `TRUSTED_PROXIES`). Mal configurado,
 * todas las peticiones parecen venir de la IP del proxy, y un solo atacante
 * bloquearía a todos los clientes a la vez.
 *
 * ── El contador vive en memoria ─────────────────────────────────────────────
 *
 * Con una instancia del middleware es correcto. Con varias réplicas, cada una
 * cuenta por su lado y el límite real se multiplica por el número de réplicas,
 * sin ningún error que lo delate. Está escrito en #14: antes de escalar hace falta
 * un almacén compartido, y es lo único del proyecto que llegaría a justificar
 * Redis.
 */

/** Ventana del límite por key. `rateLimitPerMinute` se mide contra ella. */
export const VENTANA_POR_KEY_MS = 60_000;

/** Lo que `api_keys.rate_limit_per_minute` pone por defecto en el esquema. */
export const LIMITE_POR_KEY_POR_DEFECTO = 60;

/** 401 por IP en la ventana de `preAuth` antes de cortar. */
export const FALLOS_DE_AUTENTICACION_POR_IP = 50;
export const VENTANA_PRE_AUTH_MS = 15 * 60_000;

function apiKeyIdDe(req: Request): string {
  const id = req.identity?.apiKeyId;
  // Si falta, este limitador se montó antes de `authApiKey`. Seguir con una clave
  // `undefined` metería a TODOS los clientes en el mismo contador.
  if (!id) throw new Error('rateLimitPublico.porKey sin apiKeyId: va después de authApiKey()');
  return id;
}

export interface LimitadoresPublicos {
  preAuth: RequestHandler;
  porKey: RequestHandler;
}

/**
 * Crea los dos limitadores con su propio contador.
 *
 * Es una fábrica y no un par de constantes a propósito: un limitador de módulo
 * compartiría el contador con TODAS las apps que se creen en el mismo proceso.
 * En producción hay una sola, pero en los tests cada `createApp()` heredaría las
 * peticiones de los anteriores y un test acabaría recibiendo el 429 de otro.
 */
export function crearLimitadoresPublicos(): LimitadoresPublicos {
  const preAuth = rateLimit({
    windowMs: VENTANA_PRE_AUTH_MS,
    limit: FALLOS_DE_AUTENTICACION_POR_IP,
    // Solo cuentan los 401. `skipSuccessfulRequests` descuenta al terminar lo que
    // `requestWasSuccessful` considere un éxito, y aquí éxito es "no fue un 401".
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    // `draft-6`: cabeceras `RateLimit-Limit/-Remaining/-Reset` separadas. Las
    // rutas internas usan `draft-7`, pero esta API la consumen integraciones de
    // terceros, y las cabeceras separadas son las que entiende casi cualquier
    // cliente HTTP.
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos de autenticación fallidos. Espera antes de reintentar.',
      },
    },
  });

  const porKey = rateLimit({
    windowMs: VENTANA_POR_KEY_MS,
    // Se lee en cada petición: cambiar el límite de una key en `api_keys` tiene
    // efecto en la siguiente, sin reiniciar el servidor.
    limit: (req) => req.identity?.rateLimitPerMinute ?? LIMITE_POR_KEY_POR_DEFECTO,
    keyGenerator: apiKeyIdDe,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Esta API key superó su límite de peticiones por minuto.',
      },
    },
  });

  return { preAuth, porKey };
}
