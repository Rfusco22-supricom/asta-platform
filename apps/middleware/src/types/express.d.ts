import type { Identity } from '@asta/shared-types';

/**
 * Augmentación de Express.
 *
 * Vive en su propio archivo y depende solo de `@asta/shared-types` a propósito.
 * Antes estaba dentro de `middleware/apiKeyAuth.ts`, que importa `@prisma/client`:
 * eso hacía que CUALQUIER archivo que tocara `req.identity` —incluido el
 * controlador de vendedores, que no usa Postgres para nada— arrastrara la
 * dependencia del cliente de Prisma generado, y no compilara hasta tener la base
 * de datos montada.
 *
 * Un tipo compartido no debe arrastrar la infraestructura de quien lo definió.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Identidad resuelta del solicitante. La produce `authJwt()` (panel, app) o
       * `authApiKey()` (integraciones), con la misma forma en ambos casos: los
       * controladores no necesitan saber por qué puerta entró el request.
       */
      identity: Identity;
      /** partner_id efectivo, derivado del token — nunca del input del cliente. */
      scopedPartnerId?: number;
      /** Logger por request (pino-http). */
      log?: {
        warn: (obj: unknown, msg?: string) => void;
        error: (obj: unknown, msg?: string) => void;
      };
    }
  }
}

export {};
