import { z } from 'zod';
import { odooIdSchema } from './common.js';

/**
 * Roles, tiers y scopes. Es la pieza que más consumen los tres clientes, porque
 * de ella cuelga qué se muestra y qué no.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

export const appRoleSchema = z.enum(['SUPERADMIN', 'VENDEDOR', 'BRONCE', 'PLATA', 'GOLD']);
export type AppRole = z.infer<typeof appRoleSchema>;

/** Los tres roles que son en realidad niveles de cliente. */
export const clientTierSchema = z.enum(['BRONCE', 'PLATA', 'GOLD']);
export type ClientTier = z.infer<typeof clientTierSchema>;

const CLIENT_ROLES = new Set<AppRole>(['BRONCE', 'PLATA', 'GOLD']);

/**
 * BRONCE, PLATA y GOLD son *tiers* del mismo rol funcional: cliente. Se
 * distinguen para resolver la tarifa, no para dar permisos distintos.
 *
 * Úsalo siempre en vez de enumerar los tres a mano. Cuando aparezca un cuarto
 * nivel (PLATINO, lo que sea), solo hay que tocarlo aquí.
 */
export function isClientRole(role: AppRole): role is ClientTier {
  return CLIENT_ROLES.has(role);
}

export function isStaffRole(role: AppRole): boolean {
  return role === 'SUPERADMIN' || role === 'VENDEDOR';
}

/** Etiquetas para mostrar. El enum es técnico; esto es lo que ve el usuario. */
export const ROLE_LABEL: Record<AppRole, string> = {
  SUPERADMIN: 'Administrador',
  VENDEDOR: 'Vendedor',
  BRONCE: 'Bronce',
  PLATA: 'Plata',
  GOLD: 'Gold',
};

// ─────────────────────────────────────────────────────────────────────────────
// Scopes de API
// ─────────────────────────────────────────────────────────────────────────────

export const apiScopeSchema = z.enum([
  'INVENTORY_READ',
  'PRICING_READ',
  'INVOICES_READ',
  'ORDERS_READ',
  'ORDERS_WRITE',
  'RECOMMENDER_READ',
]);

export type ApiScope = z.infer<typeof apiScopeSchema>;

/**
 * Descripción de cada scope para la UI de creación de keys.
 *
 * El cliente tiene que poder decidir con conocimiento qué le está dando a su
 * integración. "INVENTORY_READ" no le dice nada a nadie.
 */
export const SCOPE_DESCRIPTION: Record<ApiScope, string> = {
  INVENTORY_READ: 'Consultar el catálogo y las existencias',
  PRICING_READ: 'Ver los precios de su tarifa',
  INVOICES_READ: 'Consultar sus facturas y saldos',
  ORDERS_READ: 'Consultar sus pedidos',
  ORDERS_WRITE: 'Crear pedidos (quedan en borrador y requieren confirmación)',
  RECOMMENDER_READ: 'Consultar compatibilidad entre impresoras y tóner',
};

/** Scopes que modifican datos. La UI debe marcarlos aparte. */
export const WRITE_SCOPES: readonly ApiScope[] = ['ORDERS_WRITE'];

// ─────────────────────────────────────────────────────────────────────────────
// Identidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identidad resuelta del solicitante.
 *
 * El middleware produce exactamente esta forma tanto si el request entró con
 * JWT (panel, app) como con API key (integraciones). Los controladores no
 * necesitan saber por cuál de las dos puertas entró.
 */
export const identitySchema = z.object({
  appUserId: z.uuid(),
  role: appRoleSchema,
  odooPartnerId: odooIdSchema,
  /** Solo para SUPERADMIN y VENDEDOR: su res.users.id en Odoo. */
  odooUserId: odooIdSchema.nullable(),
  /** Tarifa resuelta desde su tier. */
  odooPricelistId: odooIdSchema.nullable(),
  /** Vacío cuando la identidad viene de un JWT: los scopes son de las API keys. */
  scopes: z.array(apiScopeSchema).default([]),
  /**
   * Solo presente cuando el request entró con API key. Ausente con JWT.
   *
   * Es la única asimetría entre las dos puertas de autenticación, y está aquí
   * porque los logs de acceso cruzado necesitan saber *qué key* lo intentó, no
   * solo qué usuario.
   */
  apiKeyId: z.uuid().optional(),
  /**
   * Límite de peticiones por minuto de la key (#29). Solo con API key, igual que
   * `apiKeyId`.
   *
   * Viaja en la identidad porque sale de la misma fila que la verificación: así
   * cambiarlo en `api_keys` tiene efecto en la siguiente petición, sin reiniciar
   * nada ni consultar la base una segunda vez.
   */
  rateLimitPerMinute: z.number().int().positive().optional(),
  /**
   * Solo presente cuando el request entró con JWT. Ausente con API key.
   *
   * Es la simétrica de `apiKeyId`, y existe por la pantalla de sesiones activas
   * (#52): sin saber desde qué sesión se está mirando, la lista no puede marcar
   * cuál es "esta" — y cerrar la propia creyendo que era la de otro es
   * exactamente el error que esa pantalla debe evitar.
   */
  sessionId: z.uuid().optional(),
});

export type Identity = z.infer<typeof identitySchema>;

/** Lo que el frontend recibe de `GET /me` para pintar la sesión. */
export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  nombre: z.string(),
  role: appRoleSchema,
  tier: clientTierSchema.nullable(),
  odooPartnerId: odooIdSchema,
  vendedorAsignado: z
    .object({ id: z.uuid(), nombre: z.string(), email: z.email().nullable() })
    .nullable(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Contraseñas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Longitud mínima de contraseña.
 *
 * Vive aquí, y no en el middleware, porque el formulario y el validador tienen
 * que decir EXACTAMENTE lo mismo. Estaban desalineados —la pantalla pedía 12 y
 * el servidor exigía 10—, y ese tipo de desajuste enseña al usuario que los
 * mensajes de la aplicación no son de fiar.
 *
 * 10 sin exigir mayúsculas ni símbolos: esas reglas producen "Passw0rd!" y
 * empujan a apuntar la clave en un papel. Una frase larga es más fuerte.
 */
export const LONGITUD_MINIMA_CONTRASENA = 10;
