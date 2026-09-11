import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AppRole, Identity } from '@asta/shared-types';
import { searchRead } from '../odoo/client.js';

/**
 * ATAJO DE AUTENTICACIÓN PARA DESARROLLO. NO ES authJwt().
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * Los endpoints de vendedores (#21) leen exclusivamente de Odoo: no tocan MySQL
 * para nada. Pero `authJwt()` sí necesita la base —y la autenticación propia
 * completa es la Fase 2 (#17, #51, #52)—, así que sin un atajo no se puede
 * probar la Fase 3 hasta tener las dos cosas.
 *
 * Este módulo fabrica una identidad a partir de un `res.users.id` de Odoo, para
 * poder verificar los endpoints contra datos reales hoy.
 *
 * ── Por qué está blindado así ─────────────────────────────────────────────────
 *
 * Un bypass de autenticación es exactamente el tipo de código que sobrevive por
 * accidente hasta producción, porque nunca falla — simplemente deja pasar. Por
 * eso aquí no hay un `if` discreto: el módulo **revienta al importarse** si el
 * entorno es de producción, y grita en cada request.
 *
 * Cuando #17 esté hecho, este archivo se BORRA. No se deja "por si acaso".
 */

// ── Guarda 1: el módulo no se deja ni cargar en producción ───────────────────
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'authDev.ts se ha importado con NODE_ENV=production. ' +
      'Este módulo es un bypass de autenticación y no puede existir en producción. ' +
      'Usa authJwt() (issue #17).',
  );
}

// ── Guarda 2: hace falta activarlo explícitamente ────────────────────────────
const ENABLED = process.env.DEV_AUTH_ENABLED === 'true';

interface OdooUserRow {
  id: number;
  name: string;
  login: string;
  partner_id: [number, string] | false;
}

/** Cache en memoria: el atajo no debería costar un RPC por request. */
const cache = new Map<number, Identity>();

async function buildIdentity(odooUserId: number, role: AppRole): Promise<Identity | null> {
  const cached = cache.get(odooUserId);
  if (cached && cached.role === role) return cached;

  const rows = await searchRead<OdooUserRow>(
    'res.users',
    [['id', '=', odooUserId]],
    ['id', 'name', 'login', 'partner_id'],
  );
  if (!rows[0]) return null;

  const identity: Identity = {
    // UUID fijo y reconocible: si aparece en un log de producción, es una alarma.
    appUserId: '00000000-0000-4000-8000-00000000dev0',
    role,
    odooPartnerId: rows[0].partner_id ? rows[0].partner_id[0] : 0,
    odooUserId,
    odooPricelistId: null,
    scopes: [],
  };

  cache.set(odooUserId, identity);
  return identity;
}

/**
 * Identidad falsa para desarrollo.
 *
 *   curl -H "X-Dev-Odoo-User-Id: 406" http://localhost:3001/api/v1/salesperson/portfolio
 *
 * Cabeceras:
 *   X-Dev-Odoo-User-Id : res.users.id de Odoo (obligatoria)
 *   X-Dev-Role         : SUPERADMIN | VENDEDOR (por defecto VENDEDOR)
 */
export function authDev(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!ENABLED) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Autenticación no disponible. authJwt() es el issue #17.',
        },
      });
      return;
    }

    const raw = req.get('x-dev-odoo-user-id') ?? process.env.DEV_AUTH_ODOO_USER_ID;
    const odooUserId = Number(raw);

    if (!raw || !Number.isInteger(odooUserId) || odooUserId <= 0) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Falta la cabecera X-Dev-Odoo-User-Id con un res.users.id válido.',
        },
      });
      return;
    }

    const headerRole = (req.get('x-dev-role') ?? 'VENDEDOR').toUpperCase();
    const role: AppRole = headerRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'VENDEDOR';

    try {
      const identity = await buildIdentity(odooUserId, role);
      if (!identity) {
        res.status(401).json({
          error: { code: 'UNAUTHENTICATED', message: `No existe res.users ${odooUserId} en Odoo.` },
        });
        return;
      }

      // Guarda 3: ruido en cada request. Si esto sale en un log serio, se ve.
      req.log?.warn(
        { odooUserId, role, path: req.path },
        'AUTENTICACIÓN DE DESARROLLO — identidad sin verificar',
      );
      res.setHeader('X-Auth-Mode', 'development-bypass');

      req.identity = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Aviso al arrancar, para que nadie levante el servidor sin enterarse. */
export function warnIfDevAuthEnabled(): void {
  if (!ENABLED) return;
  const line = '─'.repeat(70);
  console.warn(`\n${line}`);
  console.warn('  DEV_AUTH_ENABLED=true — la autenticación está DESACTIVADA.');
  console.warn('  Cualquiera con la cabecera X-Dev-Odoo-User-Id es ese vendedor.');
  console.warn('  Solo para desarrollo local. Ver issue #17.');
  console.warn(`${line}\n`);
}
