import { buscarImpresoras, compatiblesDe, type Busqueda, type Config, type ProductoCompatible, type Resultado } from './api.js';
import { CLAVES, type CacheLocal } from './cache.js';

/**
 * La capa que decide qué se enseña cuando no hay red (#42).
 *
 * Regla: **lo vivo manda; lo guardado rescata.** Se pide al servidor; si
 * responde, eso es lo que se enseña y lo que se guarda. Si no hay red, se
 * enseña lo último que se supo, con su fecha, para que la pantalla pueda
 * decirlo.
 *
 * Un 4xx/5xx NO cae a la caché: el servidor contestó y dijo que no. Enseñar
 * datos viejos ante un 403 taparía que la tablet está mal configurada; ante un
 * 404, que la impresora ya no está. Solo el fallo de RED justifica el rescate.
 */

export interface Respuesta<T> {
  ok: true;
  datos: T;
  /** true si esto sale de la caché: la pantalla tiene que decirlo. */
  desdeCache: boolean;
  /** Cuándo se guardó, si viene de la caché. */
  guardadoEn: number | null;
}

export type ResultadoConCache<T> = Respuesta<T> | (Extract<Resultado<T>, { ok: false }> & { huboCache: false });

async function conCache<T>(
  cache: CacheLocal,
  clave: string,
  pedir: () => Promise<Resultado<T>>,
  alConectar: (ok: boolean) => void,
): Promise<ResultadoConCache<T>> {
  const r = await pedir();
  alConectar(r.ok || r.motivo !== 'red');

  if (r.ok) {
    await cache.guardar(clave, r.datos);
    return { ok: true, datos: r.datos, desdeCache: false, guardadoEn: null };
  }
  if (r.motivo !== 'red') return { ...r, huboCache: false };

  const guardado = await cache.leer<T>(clave);
  if (!guardado) return { ...r, huboCache: false };
  return { ok: true, datos: guardado.datos, desdeCache: true, guardadoEn: guardado.guardadoEn };
}

export function buscarConCache(
  config: Config,
  cache: CacheLocal,
  q: string,
  alConectar: (ok: boolean) => void = () => {},
): Promise<ResultadoConCache<Busqueda>> {
  return conCache(cache, CLAVES.busqueda(q), () => buscarImpresoras(config, q), alConectar);
}

export function compatiblesConCache(
  config: Config,
  cache: CacheLocal,
  impresoraId: number,
  busquedaId: string | null,
  alConectar: (ok: boolean) => void = () => {},
): Promise<ResultadoConCache<ProductoCompatible[]>> {
  return conCache(cache, CLAVES.compatibles(impresoraId), () => compatiblesDe(config, impresoraId, busquedaId), alConectar);
}

/** "hace 3 min", "hace 2 h". Lo que se pone al lado de unos datos guardados. */
export function haceCuanto(guardadoEn: number, ahora = Date.now()): string {
  const minutos = Math.max(0, Math.round((ahora - guardadoEn) / 60_000));
  if (minutos < 1) return 'hace menos de un minuto';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`;
}
