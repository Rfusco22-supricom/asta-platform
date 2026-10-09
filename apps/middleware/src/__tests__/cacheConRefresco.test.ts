import { describe, expect, it } from 'vitest';
import { CacheConRefresco } from '../utils/cacheConRefresco.js';

/**
 * La cache de las pantallas (`utils/cacheConRefresco.ts`), con un reloj de
 * mentira: fresco 1 s, máximo 10 s.
 */

function preparar() {
  let ahora = 0;
  const cache = new CacheConRefresco<string>(1_000, 10_000, 2, () => ahora);
  let lecturas = 0;
  let siguiente = 'v1';
  const cargar = async () => {
    lecturas++;
    return siguiente;
  };
  return {
    cache,
    cargar,
    avanzar: (ms: number) => (ahora += ms),
    lecturas: () => lecturas,
    cambiar: (v: string) => (siguiente = v),
  };
}

/** Deja correr lo que se lanzó por detrás. */
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('CacheConRefresco', () => {
  it('fresco: contesta con lo guardado sin leer', async () => {
    const c = preparar();
    expect(await c.cache.obtener('k', c.cargar)).toBe('v1');
    c.avanzar(500);
    expect(await c.cache.obtener('k', c.cargar)).toBe('v1');
    expect(c.lecturas()).toBe(1);
  });

  it('pasado el fresco: contesta con lo viejo al momento y renueva por detrás', async () => {
    const c = preparar();
    await c.cache.obtener('k', c.cargar);
    c.cambiar('v2');
    c.avanzar(2_000);
    expect(await c.cache.obtener('k', c.cargar)).toBe('v1');
    await esperar();
    expect(c.lecturas()).toBe(2);
    expect(await c.cache.obtener('k', c.cargar)).toBe('v2');
  });

  it('pasado el máximo: espera a lo nuevo', async () => {
    const c = preparar();
    await c.cache.obtener('k', c.cargar);
    c.cambiar('v2');
    c.avanzar(11_000);
    expect(await c.cache.obtener('k', c.cargar)).toBe('v2');
  });

  it('dos peticiones a la vez comparten una lectura', async () => {
    const c = preparar();
    const [a, b] = await Promise.all([c.cache.obtener('k', c.cargar), c.cache.obtener('k', c.cargar)]);
    expect([a, b]).toEqual(['v1', 'v1']);
    expect(c.lecturas()).toBe(1);
  });

  it('un fallo renovando por detrás deja lo que había; sin nada guardado, se propaga', async () => {
    const c = preparar();
    await c.cache.obtener('k', c.cargar);
    c.avanzar(2_000);
    const falla = async (): Promise<string> => {
      throw new Error('Odoo caído');
    };
    expect(await c.cache.obtener('k', falla)).toBe('v1');
    await esperar();
    expect(await c.cache.obtener('k', c.cargar)).toBe('v1');
    await expect(c.cache.obtener('otra', falla)).rejects.toThrow('Odoo caído');
  });

  it('cada clave es suya, y al llenarse se va la más antigua', async () => {
    const c = preparar();
    await c.cache.obtener('a', async () => 'A');
    await c.cache.obtener('b', async () => 'B');
    await c.cache.obtener('c', async () => 'C');
    expect(await c.cache.obtener('b', c.cargar)).toBe('B');
    expect(await c.cache.obtener('a', c.cargar)).toBe('v1');
  });
});
