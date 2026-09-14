import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { ejecutarEnContexto, nuevoContexto } from '../utils/contextoPeticion.js';

/**
 * Bitácora de la API pública: una fila en `api_request_logs` por petición (#29).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Tres alertas de #46 leen esta tabla —`key-401`, `tasa-5xx` y
 * `odoo-n-mas-uno`— y la cuarta, `key-429`, llega con este cambio. Pero nada
 * escribía en ella: la API pública estaba sirviendo tráfico real desde #64 y la
 * tabla seguía con 0 filas. Las reglas estaban probadas contra datos sembrados,
 * así que sus tests pasaban, pero en producción no podían dispararse nunca.
 *
 * ── Qué garantiza ────────────────────────────────────────────────────────────
 *
 * · Se monta PRIMERO en el router, así que registra también lo que cortan los
 *   limitadores (429) y la autenticación (401). Son justo las filas que más
 *   interesan a las alertas.
 *
 * · Nunca retrasa ni tumba una petición. El INSERT se hace cuando la respuesta
 *   ya salió, y un fallo al escribir se traga: sin bitácora se pierde
 *   visibilidad, pero con una bitácora que lanza se pierde la API.
 *
 * · Guarda la ruta SIN la query string. La query puede llevar filtros o un
 *   `partner_id` ajeno, y esta tabla la lee gente de operación con el usuario de
 *   informes (#44).
 *
 * ── Qué no garantiza ─────────────────────────────────────────────────────────
 *
 * Una petición que el cliente corta antes de recibir la respuesta no llega a
 * `finish` y no se registra. Es tráfico que tampoco llegó a completarse.
 */

const MAX_USER_AGENT = 500;
const MAX_PATH = 255;

/** Captura el `error.code` del cuerpo, sin cambiar lo que se envía. */
function espiarCodigoDeError(res: Response): () => string | null {
  let codigo: string | null = null;
  const jsonOriginal = res.json.bind(res);
  res.json = ((body: unknown) => {
    const c = (body as { error?: { code?: unknown } } | null)?.error?.code;
    if (typeof c === 'string') codigo = c.slice(0, 64);
    return jsonOriginal(body);
  }) as Response['json'];
  return () => codigo;
}

export function registroPeticiones(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const inicio = performance.now();
    const codigoDeError = espiarCodigoDeError(res);
    // Se captura AHORA y de `originalUrl`: Express reescribe `baseUrl` y `url` al
    // entrar y salir de cada router, y cuando llega `finish` ya no son fiables.
    const ruta = req.originalUrl.split('?')[0].slice(0, MAX_PATH);

    // `finish` lee el contexto por cierre, no por el almacén, porque el evento
    // puede dispararse fuera del contexto asíncrono de la petición.
    const contexto = nuevoContexto();

    // El listener se registra ANTES de seguir la cadena. Si algún middleware
    // posterior respondiera de forma síncrona, no dependemos de que `finish` se
    // emita en diferido para no perdernos la fila.
    res.on('finish', () => {
      // TODO el trabajo va dentro de una función async, no solo el INSERT.
      //
      // Antes era `prisma.apiRequestLog.create(...).catch(...)`, y ese `.catch`
      // solo atrapa los fallos ASÍNCRONOS. Si algo lanzaba de forma síncrona —al
      // montar la fila, o el propio `create`— la excepción escapaba del listener
      // de `finish` antes de que hubiera una promesa, y una excepción no capturada
      // en un listener de eventos termina el proceso de Node. Lo destapó un test.
      // Una función async convierte cualquier `throw` en un rechazo, y ese sí se
      // captura.
      const escribir = async (): Promise<void> => {
        await prisma.apiRequestLog.create({
          data: {
            // Con key válida, la de la identidad. Con key rechazada, la que se
            // pudo atribuir (prefijo real). Con key inventada, ninguna.
            apiKeyId: req.identity?.apiKeyId ?? (res.locals.apiKeyIdRechazada as string | undefined) ?? null,
            odooPartnerId: req.identity?.odooPartnerId ?? null,
            method: req.method.slice(0, 8),
            path: ruta,
            statusCode: res.statusCode,
            durationMs: Math.max(0, Math.round(performance.now() - inicio)),
            odooCalls: contexto.odooCalls,
            errorCode: codigoDeError(),
            ip: req.ip?.slice(0, 45) ?? null,
            userAgent: req.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null,
            // `createdAt` se deja a Prisma, que lo genera en UTC. NO al DEFAULT de
            // la columna, que es hora local del servidor. Comprobado: las reglas
            // de alertas filtran por "últimos N minutos" en UTC.
          },
        });
      };

      escribir().catch((error: unknown) => {
        try {
          req.log?.warn(
            { err: error instanceof Error ? error.message : String(error) },
            'no se pudo escribir api_request_logs',
          );
        } catch {
          /* ni siquiera el aviso de que falló puede tumbar el proceso */
        }
      });
    });

    // Y solo ahora se sigue la cadena, dentro del contexto: todo lo que corra
    // después, incluidos los RPC a Odoo de los controladores, cuenta aquí.
    ejecutarEnContexto(contexto, () => next());
  };
}
