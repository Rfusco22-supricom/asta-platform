import type { ClientTier } from '@asta/shared-types';

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
 * DÓNDE VIVE EL MAPEO (#131): en la tabla `tier_pricelist_map`, que se lee con
 * `cargarMapaTiers()` (`services/tiers.service.ts`). Antes era un objeto fijo en
 * este fichero, y mover una tarifa de nivel exigía desplegar. Aquí quedan solo
 * las reglas, que no dependen de qué haya en la tabla.
 *
 * La clave es el ID de la tarifa, nunca su nombre: hay nombres repetidos entre
 * compañías ("Lista de Precios P" son la 15861 y la 15862).
 */

/** El mapeo tarifa → nivel, ya cargado. */
export interface MapaTiers {
  readonly porTarifa: ReadonlyMap<number, ClientTier>;
  /**
   * Resumen del contenido, que cambia si cambia cualquier fila. El sync lo
   * guarda para saber que el mapeo se movió y releer a todos (ver
   * `sincronizarPartners`).
   */
  readonly huella: string;
}

/**
 * Nivel que se asigna cuando el cliente no tiene tarifa, o tiene una que no está
 * mapeada.
 *
 * BRONCE a propósito: ante la duda, el precio menos favorable. Un cliente que
 * por un hueco de configuración recibe precios de GOLD es una pérdida real y
 * silenciosa; uno que recibe BRONCE de más se queja, y entonces te enteras.
 */
export const DEFAULT_TIER: ClientTier = 'BRONCE';

export function tierFromPricelist(pricelistId: number | null, mapa: MapaTiers): ClientTier {
  if (pricelistId === null) return DEFAULT_TIER;
  return mapa.porTarifa.get(pricelistId) ?? DEFAULT_TIER;
}

/** true si la tarifa del cliente no está en el mapeo: señal de configuración incompleta. */
export function isUnmappedPricelist(pricelistId: number | null, mapa: MapaTiers): boolean {
  return pricelistId !== null && !mapa.porTarifa.has(pricelistId);
}
