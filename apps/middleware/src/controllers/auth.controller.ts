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

/**
 * Endpoints de sesión.
 *
 * El refresh token viaja en una cookie httpOnly, no en el cuerpo de la
 * respuesta: así el JavaScript del navegador no puede leerlo y un XSS no se lo
 * lleva. El access token sí va en el cuerpo — dura 15 minutos y el cliente
 * necesita ponerlo en la cabecera de cada llamada.
 */

const COOKIE_REFRESH = 'asta_rt';

function ctx(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
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
    if (req.identity) invalidarCacheSesion(req.identity.appUserId);

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
