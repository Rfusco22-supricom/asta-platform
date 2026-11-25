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

  it('olvidar: la siguiente petición vuelve a leer, aunque lo guardado fuera fresco', async () => {
    const c = preparar();
    expect(await c.cache.obtener('k', c.cargar)).toBe('v1');
    c.cambiar('v2');
    c.cache.olvidar('k');
    expect(await c.cache.obtener('k', c.cargar)).toBe('v2');
    expect(c.lecturas()).toBe(2);
    // Y lo nuevo queda guardado.
    expect(await c.cache.obtener('k', c.cargar)).toBe('v2');
    expect(c.lecturas()).toBe(2);
  });

  it('olvidar con una lectura en curso: esa lectura no se guarda, es de antes del cambio', async () => {
    let soltar: (v: string) => void = () => undefined;
    const cache = new CacheConRefresco<string>(1_000, 10_000, 2, () => 0);
    const lenta = cache.obtener('k', () => new Promise<string>((r) => (soltar = r)));
    cache.olvidar('k');
    // Una petición nueva tras olvidar no se engancha a la lectura vieja.
    const nueva = cache.obtener('k', async () => 'nuevo');
    soltar('viejo');
    expect(await lenta).toBe('viejo');
    expect(await nueva).toBe('nuevo');
    expect(await cache.obtener('k', async () => 'no debería leerse')).toBe('nuevo');
  });

  describe('renovarUsadas: las pantallas que se usaron siguen calientes', () => {
    const opciones = { usadasEnMs: 60_000, masViejasDeMs: 5_000, maximo: 10, enParalelo: 2 };

    it('vuelve a leer lo usado hace poco antes de que caduque, y la siguiente visita no espera', async () => {
      const c = preparar();
      await c.cache.obtener('k', c.cargar);
      c.cambiar('v2');
      c.avanzar(6_000);
      expect(await c.cache.renovarUsadas(opciones)).toEqual({ renovadas: 1, fallidas: 0 });
      expect(c.lecturas()).toBe(2);
      // A los 12 s de la primera lectura habría caducado (máximo 10 s) y se
      // esperaría a la fuente. No caducó: contesta al momento con lo renovado
      // (y, pasado el fresco, renueva otra vez por detrás).
      c.avanzar(6_000);
      c.cambiar('v3');
      expect(await c.cache.obtener('k', c.cargar)).toBe('v2');
    });

    it('no toca lo recién guardado ni lo que nadie pidió en el tiempo de `usadasEnMs`', async () => {
      const c = preparar();
      await c.cache.obtener('k', c.cargar);
      c.avanzar(1_000);
      expect(await c.cache.renovarUsadas(opciones)).toEqual({ renovadas: 0, fallidas: 0 });
      c.avanzar(60_000);
      expect(await c.cache.renovarUsadas(opciones)).toEqual({ renovadas: 0, fallidas: 0 });
      expect(c.lecturas()).toBe(1);
    });

    it('un fallo deja lo que había y se cuenta', async () => {
      let ahora = 0;
      const cache = new CacheConRefresco<string>(1_000, 10_000, 5, () => ahora);
      let falla = false;
      const cargar = async () => {
        if (falla) throw new Error('Odoo no contesta');
        return 'v1';
      };
      await cache.obtener('k', cargar);
      falla = true;
      ahora += 6_000;
      expect(await cache.renovarUsadas(opciones)).toEqual({ renovadas: 0, fallidas: 1 });
      expect(await cache.obtener('k', cargar)).toBe('v1');
    });

    it('como mucho `maximo`, las usadas más recientemente primero', async () => {
      let ahora = 0;
      const cache = new CacheConRefresco<string>(1_000, 10_000, 10, () => ahora);
      const leidas: string[] = [];
      const cargar = (k: string) => async () => {
        leidas.push(k);
        return k;
      };
      for (const k of ['a', 'b', 'c']) {
        await cache.obtener(k, cargar(k));
        ahora += 100;
      }
      leidas.length = 0;
      ahora += 6_000;
      await cache.renovarUsadas({ ...opciones, maximo: 2, enParalelo: 1 });
      expect(leidas).toEqual(['c', 'b']);
    });
  
    it('no renueva lo que `vigente` da por pasado (otro día)', async () => {
      const c = preparar();
      await c.cache.obtener('k', c.cargar);
      c.avanzar(6_000);
      expect(await c.cache.renovarUsadas({ ...opciones, vigente: () => false })).toEqual({ renovadas: 0, fallidas: 0 });
      expect(c.lecturas()).toBe(1);
    });
});
});

describe('pantallas: solo se renueva lo pedido hoy en Caracas', () => {
  it('mismoDia corta a la medianoche de Venezuela (04:00 UTC)', async () => {
    const { mismoDia } = await import('../services/pantallas.js');
    const ms = (iso: string) => Date.parse(iso);
    expect(mismoDia(ms('2026-11-25T12:00:00Z'), ms('2026-11-26T03:59:00Z'))).toBe(true);
    expect(mismoDia(ms('2026-11-25T12:00:00Z'), ms('2026-11-26T04:01:00Z'))).toBe(false);
  });
});
