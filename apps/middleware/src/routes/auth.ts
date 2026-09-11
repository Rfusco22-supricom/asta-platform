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
