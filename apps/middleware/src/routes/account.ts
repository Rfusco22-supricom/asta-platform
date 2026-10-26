import { Router } from 'express';
import { z } from 'zod';
import { cambioKioscoSchema, nuevoCodigoClienteSchema } from '@asta/shared-types';
import { authJwt } from '../middleware/authJwt.js';
import { autorizar } from '../middleware/autorizar.js';
import {
  deleteApiKey,
  getApiKeys,
  getApiKeyUsage,
  postApiKey,
} from '../controllers/apiKeys.controller.js';
import { auditContext } from '../middleware/auditContext.js';
import { recordAudit } from '../services/audit.service.js';
import { cambiarKiosco, codigoParaCliente, estadoCodigo, listarKioscos } from '../services/kioscos.service.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Las tablets de SU tienda
// ─────────────────────────────────────────────────────────────────────────────
//
// El cliente vincula tablets con la aplicación ASTA para su propia tienda.
// Enseñan solo compatibilidades: no tienen almacén, y el cliente no puede
// elegir uno. Mismo ámbito `identidad` que las keys: el dueño sale del token
// (`odooPartnerId`), nunca de la petición, y una tablet ajena responde lo mismo
// que una que no existe.

const gestionarTablets = autorizar('tablets.propias.gestionar');
const idUuid = z.uuid();

accountRouter.get('/tablets', gestionarTablets, async (req, res, next) => {
  try {
    const { kioscos } = await listarKioscos(req.identity.odooPartnerId);
    res.json({ data: kioscos, meta: { odooDisponible: true } });
  } catch (error) {
    next(error);
  }
});

/** Un código de 6 dígitos para vincular una tablet. Sale una vez y caduca en minutos. */
accountRouter.post('/tablets/codigos', gestionarTablets, async (req, res, next) => {
  try {
    const cuerpo = nuevoCodigoClienteSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await codigoParaCliente(cuerpo.data, req.identity.odooPartnerId, req.identity.appUserId);
    recordAudit({
      action: 'kiosco.codigo_creado',
      ...auditContext(req),
      targetType: 'kiosk_codigos',
      targetId: r.id,
      metadata: { nombre: cuerpo.data.nombre, odooPartnerId: req.identity.odooPartnerId },
    });
    res.status(201).json({ data: r });
  } catch (error) {
    next(error);
  }
});

accountRouter.get('/tablets/codigos/:id', gestionarTablets, async (req, res, next) => {
  try {
    const id = idUuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Código no válido.' } });
      return;
    }
    res.json({ data: await estadoCodigo(id.data, req.identity.appUserId) });
  } catch (error) {
    next(error);
  }
});

/** Activar o desactivar una tablet propia. Desactivada, vuelve a pedir un código. */
accountRouter.patch('/tablets/:id', gestionarTablets, async (req, res, next) => {
  try {
    const id = idUuid.safeParse(req.params.id);
    const cuerpo = cambioKioscoSchema.safeParse(req.body);
    if (!id.success || !cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Tablet o cambio no válido.' } });
      return;
    }
    const kiosco = await cambiarKiosco(id.data, cuerpo.data.activo, req.identity.odooPartnerId);
    recordAudit({
      action: cuerpo.data.activo ? 'kiosco.activado' : 'kiosco.desactivado',
      ...auditContext(req),
      targetType: 'kiosk_devices',
      targetId: id.data,
      metadata: { odooPartnerId: req.identity.odooPartnerId },
    });
    res.json({ data: kiosco });
  } catch (error) {
    next(error);
  }
});
