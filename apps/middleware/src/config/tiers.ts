import type { AppRole, ClientTier } from '@asta/shared-types';

/**
 * Nivel comercial del cliente: de qué tarifa se deriva.
 *
 * CONTEXTO (hallazgos de Fase 0, issue #3):
 *
 * `x_client_tier` no existe en esta instancia de Odoo — `res.partner` no tiene
 * ni un solo campo `x_*`. En vez de crear un campo paralelo, el nivel se deriva
 * de `property_product_pricelist`, que es el mecanismo nativo de Odoo para
 * "qué precios le corresponden a este cliente". Una sola fuente de verdad.
 *
 * ESTADO ACTUAL: los 2942 clientes apuntan a la misma tarifa ([15866] "Lista de
 * Precios"), así que hoy TODOS caen en el nivel por defecto. La diferenciación
 * por nivel es una decisión comercial pendiente (issue #5), no un problema de
 * código: cuando existan las tarifas Bronce/Plata/Gold y los clientes estén
 * repartidos, este mapeo empieza a devolver niveles distintos sin tocar nada más.
 *
 * DÓNDE DEBE VIVIR: esto es configuración, no código. Cuando se cierre el #3
 * debe moverse a una tabla en Postgres editable por el SuperAdmin, para que
 * mover una tarifa de nivel no requiera un despliegue. Se deja aquí mientras el
 * mapeo sea trivial.
 */

/** product.pricelist.id -> nivel. Verificado contra la instancia el 2026-09-11. */
export const TIER_BY_PRICELIST: Readonly<Record<number, ClientTier>> = {
  15866: 'BRONCE', // "Lista de Precios" (USD) — la que hoy usan los 2942 clientes
};

/**
 * Nivel que se asigna cuando el cliente no tiene tarifa, o tiene una que no está
 * mapeada.
 *
 * BRONCE a propósito: ante la duda, el precio menos favorable. Un cliente que
 * por un hueco de configuración recibe precios de GOLD es una pérdida real y
 * silenciosa; uno que recibe BRONCE de más se queja, y entonces te enteras.
 */
export const DEFAULT_TIER: ClientTier = 'BRONCE';

export function tierFromPricelist(pricelistId: number | null): ClientTier {
  if (pricelistId === null) return DEFAULT_TIER;
  return TIER_BY_PRICELIST[pricelistId] ?? DEFAULT_TIER;
}

/** true si la tarifa del cliente no está en el mapeo: señal de configuración incompleta. */
export function isUnmappedPricelist(pricelistId: number | null): boolean {
  return pricelistId !== null && TIER_BY_PRICELIST[pricelistId] === undefined;
}

/** Rol de aplicación de un cliente. Los tiers son roles en el modelo de permisos. */
export function roleFromPricelist(pricelistId: number | null): AppRole {
  return tierFromPricelist(pricelistId);
}
