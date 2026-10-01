import { createHash } from 'node:crypto';
import type { ClientTier } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import type { MapaTiers } from '../config/tiers.js';

/**
 * El mapeo tarifa → nivel, leído de `tier_pricelist_map` (#131).
 *
 * ── Cada cuánto se relee ─────────────────────────────────────────────────────
 *
 * Cada 60 s como mucho. La tabla se edita a mano, varias veces al año, y la
 * pantalla de cartera la consulta en cada carga: leerla cada vez sería una
 * consulta por petición para un dato que casi nunca cambia. Un minuto de retraso
 * al mover una tarifa de nivel no le importa a nadie.
 *
 * ── Si MySQL no responde ─────────────────────────────────────────────────────
 *
 * Se LANZA. No se devuelve un mapeo vacío, que pondría a todos en BRONCE: el
 * sync escribe ese rol en `app_users`, así que un fallo pasajero de la base
 * degradaría en silencio a todos los clientes GOLD hasta la siguiente pasada. Es
 * mejor que esa pasada falle entera y lo diga.
 *
 * Si ya hay un mapeo en cache se sigue usando aunque haya caducado: es el último
 * que se leyó bien, no uno inventado.
 */

const TTL_MS = 60_000;

interface Fila {
  odooPricelistId: number;
  tier: ClientTier;
}

let enCache: { mapa: MapaTiers; caduca: number } | null = null;

/** Solo para tests. */
export function vaciarCacheTiers(): void {
  enCache = null;
}

export function construirMapa(filas: readonly Fila[]): MapaTiers {
  const porTarifa = new Map(filas.map((f) => [f.odooPricelistId, f.tier]));
  // Ordenado para que la huella no dependa del orden en que MySQL devuelva las filas.
  const contenido = [...porTarifa].sort((a, b) => a[0] - b[0]).map(([id, tier]) => `${id}:${tier}`).join(',');
  return { porTarifa, huella: createHash('sha256').update(contenido).digest('hex').slice(0, 16) };
}

export async function cargarMapaTiers(
  leer: () => Promise<Fila[]> = () => prisma.tierPricelistMap.findMany({ select: { odooPricelistId: true, tier: true } }),
  ahora: () => number = Date.now,
): Promise<MapaTiers> {
  if (enCache && enCache.caduca > ahora()) return enCache.mapa;
  try {
    const mapa = construirMapa(await leer());
    enCache = { mapa, caduca: ahora() + TTL_MS };
    return mapa;
  } catch (error) {
    if (enCache) return enCache.mapa;
    throw error;
  }
}
