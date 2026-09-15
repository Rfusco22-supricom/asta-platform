import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createApiKeyRequestSchema, revokeApiKeyRequestSchema } from '@asta/shared-types';
import {
  ApiKeyNoEncontrada,
  issueApiKey,
  listarApiKeys,
  revokeApiKey,
  usosDeApiKey,
} from '../services/apiKey.service.js';
import { prisma } from '../config/prisma.js';

/**
 * Las API keys de UN cliente, gestionadas por él mismo (issue #28).
 *
 * ── El ámbito es la identidad, no un recurso ─────────────────────────────────
 *
 * Ninguna de estas rutas recibe un id de usuario: el dueño sale SIEMPRE de
 * `req.identity.appUserId`, que viene del token firmado. Aceptar un `userId` por
 * parámetro, aunque se comprobara después, es el patrón que acaba dejando un
 * endpoint sin comprobar.
 *
 * Lo mismo con el id de la key: se pasa al servicio junto con el dueño esperado,
 * y es el servicio quien mete los dos en el mismo `where`.
 *
 * ── Por qué los vendedores NO entran aquí ────────────────────────────────────
 *
 * La matriz se lo niega (`apikeys.propias.gestionar` → `CLIENTES`). Una API key
 * existe para que un cliente conecte SU sistema; un vendedor que necesite datos
 * los tiene en el panel. Darle una key sería abrir un segundo camino a los datos
 * de su cartera que no pasa por `assertSalespersonOwnsPartner`.
 */

/**
 * Tope de keys vivas por cliente.
 *
 * No es una regla de negocio, es un freno: sin él, un bucle equivocado en la
 * integración de un cliente —o alguien con su sesión— puede crear miles de filas
 * y de paso llenar `api_key_scopes`. Diez son de sobra para separar producción,
 * pruebas y una rotación en curso.
 *
 * Cuenta solo las vivas: revocar libera hueco, que es lo que la gente espera.
 */
const MAX_KEYS_VIVAS = 10;

/** GET /api/v1/account/api-keys */
export async function getApiKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keys = await listarApiKeys(req.identity.appUserId);
    res.json({
      data: keys,
      meta: {
        total: keys.length,
        vivas: keys.filter((k) => k.revokedAt === null).length,
        maximo: MAX_KEYS_VIVAS,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/v1/account/api-keys */
export async function postApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cuerpo = createApiKeyRequestSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) },
      });
      return;
    }

    /*
     * Scopes repetidos.
     *
     * `scopes` es tabla puente con primaria `(apiKeyId, scope)`, así que un
     * `["INVOICES_READ", "INVOICES_READ"]` —trivial de mandar desde un formulario
     * con una casilla duplicada— reventaría el INSERT con un choque de clave
     * primaria y el cliente vería un 500 sin explicación.
     */
    const scopes = [...new Set(cuerpo.data.scopes)];

    const vivas = await prisma.apiKey.count({
      where: { userId: req.identity.appUserId, revokedAt: null },
    });
    if (vivas >= MAX_KEYS_VIVAS) {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `Ya tienes ${MAX_KEYS_VIVAS} API keys activas. Revoca alguna antes de crear otra.`,
        },
      });
      return;
    }

    const creada = await issueApiKey({
      userId: req.identity.appUserId,
      name: cuerpo.data.name.trim(),
      scopes,
      environment: cuerpo.data.environment,
      expiresInDays: cuerpo.data.expiresInDays,
      createdFromIp: req.ip,
    });

    /*
     * 201 con el token en claro. La ÚNICA vez que sale.
     *
     * No se registra en el log de la petición ni se devuelve en ningún otro
     * endpoint: lo que se guarda es su HMAC. Si el cliente lo pierde, se revoca
     * y se crea otra — no hay forma de recuperarlo, y eso es el diseño, no una
     * carencia.
     */
    res.status(201).json({
      data: {
        id: creada.id,
        name: cuerpo.data.name.trim(),
        environment: cuerpo.data.environment,
        prefix: creada.prefix,
        lastFour: creada.lastFour,
        scopes: creada.scopes,
        rateLimitPerMinute: 60,
        createdAt: new Date().toISOString(),
        expiresAt: creada.expiresAt?.toISOString() ?? null,
        revokedAt: null,
        lastUsedAt: null,
        usageCount: 0,
        plaintext: creada.plaintext,
        advertencia: 'Guarda este token ahora. No volverá a mostrarse.' as const,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/v1/account/api-keys/:id */
export async function deleteApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cuerpo = revokeApiKeyRequestSchema.safeParse(req.body ?? {});
    if (!cuerpo.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) },
      });
      return;
    }

    await revokeApiKey({
      apiKeyId: String(req.params.id ?? ''),
      actorId: req.identity.appUserId,
      // El dueño esperado es quien pide. NO se pasa `null`: eso es el camino del
      // SUPERADMIN y aquí no existe.
      duenoEsperado: req.identity.appUserId,
      reason: cuerpo.data.reason,
    });

    res.status(204).end();
  } catch (error) {
    if (error instanceof ApiKeyNoEncontrada) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
}

/** GET /api/v1/account/api-keys/:id/usage */
export async function getApiKeyUsage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const limite = Number(req.query.limit ?? 20);
    const filas = await usosDeApiKey(
      req.identity.appUserId,
      String(req.params.id ?? ''),
      Number.isFinite(limite) ? limite : 20,
    );
    res.json({ data: filas, meta: { total: filas.length } });
  } catch (error) {
    if (error instanceof ApiKeyNoEncontrada) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
}
