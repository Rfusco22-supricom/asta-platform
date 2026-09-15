import { Router } from 'express';
import { authJwt } from '../middleware/authJwt.js';
import { autorizar } from '../middleware/autorizar.js';
import {
  deleteApiKey,
  getApiKeys,
  getApiKeyUsage,
  postApiKey,
} from '../controllers/apiKeys.controller.js';

/**
 * Lo que un CLIENTE gestiona de su propia cuenta (issue #28).
 *
 * Router aparte de `/salesperson` y de `/admin` porque el público es otro: aquí
 * entra un BRONCE, un PLATA o un GOLD con su sesión del panel, no el personal de
 * Supricom. Mezclarlo con las rutas de vendedor habría puesto endpoints de dos
 * audiencias detrás del mismo prefijo, y el primer copiar-pegar de una ruta se
 * habría llevado el `autorizar()` de al lado, que es el equivocado.
 *
 * No confundir con `/api/v1/public`: eso es la API que se consume CON una key.
 * Esto es la pantalla donde esa key se crea, y va con sesión de navegador.
 *
 * `autorizar('apikeys.propias.gestionar')` comprueba el rol —la matriz se lo
 * niega a VENDEDOR y a SUPERADMIN— y el ámbito `identidad` lo aplica cada
 * servicio metiendo el `appUserId` dentro del `where`, igual que las sesiones
 * de #52. No hay ningún endpoint aquí que reciba de quién es lo que toca.
 */
export const accountRouter = Router();

accountRouter.use(authJwt());

const gestionarKeys = autorizar('apikeys.propias.gestionar');

accountRouter.get('/api-keys', gestionarKeys, getApiKeys);
accountRouter.post('/api-keys', gestionarKeys, postApiKey);
accountRouter.delete('/api-keys/:id', gestionarKeys, deleteApiKey);

/**
 * El historial va bajo la key y no en una ruta suelta de logs.
 *
 * Así la comprobación de propiedad es la misma que la de revocar, y no hay forma
 * de pedir «los últimos usos» sin decir de qué key: una ruta `/usage` global
 * habría necesitado su propio filtrado por dueño, escrito aparte.
 */
accountRouter.get('/api-keys/:id/usage', gestionarKeys, getApiKeyUsage);
