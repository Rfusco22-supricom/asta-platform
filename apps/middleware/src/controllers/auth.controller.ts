import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  cerrarSesion,
  cerrarTodasLasSesiones,
  login,
  refrescar,
  LoginFallido,
  RefreshInvalido,
} from '../services/auth.service.js';
import { invalidarCacheSesion } from '../middleware/authJwt.js';
import {
  listarSesiones,
  revocarLasDemas,
  revocarSesion,
  SesionNoEncontrada,
} from '../services/sessions.service.js';

/**
 * Endpoints de sesión.
 *
 * El refresh token viaja en una cookie httpOnly, no en el cuerpo de la
 * respuesta: así el JavaScript del navegador no puede leerlo y un XSS no se lo
 * lleva. El access token sí va en el cuerpo — dura 15 minutos y el cliente
 * necesita ponerlo en la cabecera de cada llamada.
 */

const COOKIE_REFRESH = 'asta_rt';

/**
 * De dónde salen la IP y el user-agent que se guardan en la sesión (issue #52).
 *
 * El navegador nunca llama aquí: todo pasa por el servidor de Next. Así que sin
 * cuidado, `req.ip` sería la del servidor de Next y `user-agent` sería `node`,
 * y la pantalla de sesiones activas quedaría inservible — todas las filas
 * diciendo "Dispositivo desconocido" desde la misma IP. Que es exactamente lo
 * que pasaba.
 *
 * `req.ip` ya lo resuelve Express con `trust proxy`: solo cree el
 * `X-Forwarded-For` si el par que lo manda está en `TRUSTED_PROXIES`.
 *
 * El user-agent no tiene equivalente estándar, así que el panel lo reenvía en
 * `X-Asta-Client-UA` y aquí solo se acepta bajo la MISMA condición: que Express
 * considere de confianza a quien llama.
 *
 * La condición se consulta con la propia función de Express en vez de mirar si
 * `req.ips` trae algo. No es lo mismo: `req.ips` solo se rellena cuando ADEMÁS
 * llega un `X-Forwarded-For`, y en desarrollo no hay ningún proxy delante de
 * Next, así que esa cabecera no existe y el user-agent real se habría
 * descartado siempre. Lo que se quiere saber aquí es si el par que llama es de
 * confianza, no si alguien mandó una cabecera.
 *
 * Creerse esa cabecera de cualquiera sería peor que no tenerla: quien llamara al
 * middleware directamente podría escribir el dispositivo que quisiera en el
 * registro de sesiones, y una intrusión parecería venir de la oficina.
 */
function parDeConfianza(req: Request): boolean {
  const esDeConfianza = req.app.get('trust proxy fn') as
    | ((direccion: string | undefined, salto: number) => boolean)
    | undefined;

  return typeof esDeConfianza === 'function' && esDeConfianza(req.socket.remoteAddress, 0);
}

function ctx(req: Request) {
  const reenviado = parDeConfianza(req) ? req.get('x-asta-client-ua') : undefined;

  return { ip: req.ip, userAgent: reenviado || req.get('user-agent') };
}

function ponerCookie(res: Response, token: string, dias: number): void {
  res.cookie(COOKIE_REFRESH, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // Acotada a la ruta que la usa: no se envía en cada petición del panel.
    path: '/api/v1/auth',
    maxAge: dias * 86_400_000,
  });
}

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(200),
});

export async function postLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      // Genérico a propósito: decir qué campo falta ayuda más a quien prueba
      // combinaciones que a quien se equivocó tecleando.
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Faltan el correo o la contraseña.' },
      });
      return;
    }

    const sesion = await login(body.data.email, body.data.password, ctx(req));
    ponerCookie(res, sesion.refreshToken, Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30));

    res.json({
      data: {
        accessToken: sesion.accessToken,
        expiraEn: sesion.expiraEn,
        usuario: sesion.usuario,
      },
    });
  } catch (error) {
    if (error instanceof LoginFallido) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: error.message } });
      return;
    }
    next(error);
  }
}

export async function postRefresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = (req.cookies?.[COOKIE_REFRESH] as string | undefined) ?? req.body?.refreshToken;
    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'No hay sesión.' } });
      return;
    }

    const sesion = await refrescar(token, ctx(req));
    ponerCookie(res, sesion.refreshToken, Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30));

    res.json({
      data: {
        accessToken: sesion.accessToken,
        expiraEn: sesion.expiraEn,
        usuario: sesion.usuario,
      },
    });
  } catch (error) {
    if (error instanceof RefreshInvalido) {
      // Se limpia la cookie: si no, el navegador reintentaría con un token
      // muerto en cada carga y el usuario vería un error que no entiende.
      res.clearCookie(COOKIE_REFRESH, { path: '/api/v1/auth' });
      res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: error.message } });
      return;
    }
    next(error);
  }
}

export async function postLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[COOKIE_REFRESH] as string | undefined;
    if (token) await cerrarSesion(token);
    // OJO: la caché de `authJwt` va indexada por ID DE SESIÓN, no de usuario.
    // Esto pasaba el `appUserId` y por tanto no borraba nada: el access token
    // seguía siendo válido hasta 5 segundos después de cerrar sesión, porque la
    // identidad cacheada se servía sin volver a mirar `revokedAt`.
    if (req.identity?.sessionId) invalidarCacheSesion(req.identity.sessionId);

    res.clearCookie(COOKIE_REFRESH, { path: '/api/v1/auth' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/** Cierra la sesión en todos los dispositivos. Requiere estar autenticado. */
export async function postLogoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cerradas = await cerrarTodasLasSesiones(req.identity.appUserId, 'logout');
    res.clearCookie(COOKIE_REFRESH, { path: '/api/v1/auth' });
    res.json({ data: { sesionesCerradas: cerradas } });
  } catch (error) {
    next(error);
  }
}

/** Quién soy. Lo usa el panel para pintar la sesión sin guardar nada. */
export function getMe(req: Request, res: Response): void {
  res.json({
    data: {
      id: req.identity.appUserId,
      role: req.identity.role,
      odooPartnerId: req.identity.odooPartnerId,
      odooUserId: req.identity.odooUserId,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sesiones activas (issue #52)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /auth/sessions
 *
 * No lleva `autorizar()`: no hay rol que deba ser incapaz de ver sus propias
 * sesiones, y el ámbito no es un recurso ajeno sino la identidad de quien pide.
 * Lo aplica el servicio metiendo el `appUserId` dentro del `where`, igual que
 * el resto de endpoints de `/auth`.
 */
export async function getSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sesiones = await listarSesiones(req.identity.appUserId, req.identity.sessionId);

    res.json({
      data: sesiones,
      meta: {
        total: sesiones.length,
        otras: sesiones.filter((s) => !s.esActual).length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** DELETE /auth/sessions/:id — cierra una sesión concreta del propio usuario. */
export async function deleteSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id ?? '');

    await revocarSesion(req.identity.appUserId, id);
    res.status(204).end();
  } catch (error) {
    if (error instanceof SesionNoEncontrada) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
}

/**
 * DELETE /auth/sessions — cierra todas menos la actual.
 *
 * Separado de `/logout-all`, que cierra TAMBIÉN la propia. Son cosas distintas:
 * quien sospecha de un intruso quiere echarlo a él, no echarse a sí mismo a
 * mitad de la operación.
 */
export async function deleteOtherSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cerradas = await revocarLasDemas(req.identity.appUserId, req.identity.sessionId);
    res.json({ data: { sesionesCerradas: cerradas } });
  } catch (error) {
    next(error);
  }
}
