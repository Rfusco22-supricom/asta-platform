import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getMe,
  postLogin,
  postLogout,
  postLogoutAll,
  postRefresh,
} from '../controllers/auth.controller.js';
import { authJwt } from '../middleware/authJwt.js';
import {
  aceptarInvitacion,
  validarInvitacion,
  ContrasenaDebil,
  InvitacionInvalida,
} from '../services/invitation.service.js';

export const authRouter = Router();

/**
 * Límite del login.
 *
 * Es la segunda mitad de la defensa contra fuerza bruta: el bloqueo por cuenta
 * (`failed_attempts`) frena a quien ataca UNA cuenta, y esto frena a quien
 * prueba una contraseña común contra MUCHAS cuentas —el "password spraying"—,
 * que el contador por usuario no detecta porque cada cuenta falla una sola vez.
 *
 * Y acota el pico de memoria: cada verificación Argon2id reserva 64 MiB, así que
 * sin límite un atacante puede tumbar el servidor solo pidiendo logins.
 */
const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera un rato.' } },
});

const limiteRefresh = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones.' } },
});

authRouter.post('/login', limiteLogin, postLogin);
authRouter.post('/refresh', limiteRefresh, postRefresh);
authRouter.post('/logout', postLogout);

authRouter.post('/logout-all', authJwt(), postLogoutAll);
authRouter.get('/me', authJwt(), getMe);

/**
 * Invitaciones.
 *
 * Públicas a propósito: quien llega aquí no tiene cuenta todavía, así que no
 * puede autenticarse. El token DEL ENLACE es la credencial.
 *
 * Con límite estricto: sin él, estos dos endpoints serían un oráculo para
 * probar tokens al azar. Y `accept` además hace un hash Argon2id, que reserva
 * 64 MiB — sin freno, unas pocas peticiones simultáneas tumbarían el proceso.
 */
const limiteInvitacion = rateLimit({
  windowMs: 15 * 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera un rato.' } },
});

authRouter.get('/invitation/:token', limiteInvitacion, async (req, res, next) => {
  try {
    res.json({ data: await validarInvitacion(String(req.params.token)) });
  } catch (error) {
    if (error instanceof InvitacionInvalida) {
      res.status(400).json({ error: { code: 'NOT_FOUND', message: error.message } });
      return;
    }
    next(error);
  }
});

authRouter.post('/invitation/:token', limiteInvitacion, async (req, res, next) => {
  try {
    const contrasena = String(req.body?.password ?? '');
    const r = await aceptarInvitacion(String(req.params.token), contrasena, req.ip);
    res.json({ data: { ok: true, email: r.email } });
  } catch (error) {
    if (error instanceof InvitacionInvalida) {
      res.status(400).json({ error: { code: 'NOT_FOUND', message: error.message } });
      return;
    }
    if (error instanceof ContrasenaDebil) {
      // Aquí SÍ se detalla: el usuario necesita saber qué corregir, y no hay
      // nada que filtrar — ya tiene el token.
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: error.message, required: error.motivos },
      });
      return;
    }
    next(error);
  }
});
