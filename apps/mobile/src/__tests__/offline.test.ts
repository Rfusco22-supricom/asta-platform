import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheLocal, CLAVES, MAX_ENTRADAS, MS_VIGENCIA, type Almacen } from '../cache.js';
import { crearVigilante, MS_REINTENTO } from '../conexion.js';
import { buscarConCache, compatiblesConCache, haceCuanto } from '../datos.js';
import type { Config } from '../api.js';

/**
 * #42 · Modo sin conexión del kiosco.
 *
 * «Una tablet en blanco en piso de venta es peor que una con datos de hace diez
 * minutos». Lo que se vigila:
 *
 *   · lo vivo manda y lo guardado rescata, pero SOLO cuando falla la red: un
 *     403 o un 404 no se tapan con datos viejos;
 *   · lo guardado caduca, y mientras tanto se dice de cuándo es;
 *   · al volver la red, la pantalla se pone al día sola.
 */

/** AsyncStorage en memoria: lo mismo que usa la app, sin React Native. */
function almacenDePrueba(): Almacen & { datos: Map<string, string>; falla: boolean } {
  const datos = new Map<string, string>();
  const a = {
    datos,
    falla: false,
    getItem: async (k: string) => {
      if (a.falla) throw new Error('almacén roto');
      return datos.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      if (a.falla) throw new Error('almacén roto');
      datos.set(k, v);
    },
    removeItem: async (k: string) => void datos.delete(k),
    getAllKeys: async () => [...datos.keys()],
  };
  return a;
}

const config: Config = { base: 'https://api.example', apiKey: 'k', fetch: async () => new Response('{}') };
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
const busquedaOk = { data: [{ id: 7, marca: 'HP', nombre: 'M404dn' }], sugerencias: [], meta: { busquedaId: '1' } };

describe('#42 · La caché guarda y caduca', () => {
  it('lo guardado se lee con su fecha', async () => {
    const almacen = almacenDePrueba();
    let ahora = 1_000_000;
    const cache = new CacheLocal(almacen, () => ahora);

    await cache.guardar('x', { a: 1 });
    ahora += 5 * 60_000;
    expect(await cache.leer('x')).toEqual({ datos: { a: 1 }, guardadoEn: 1_000_000 });
  });

  it('pasada la vigencia ya no vale: la existencia de ayer no dice nada', async () => {
    const almacen = almacenDePrueba();
    let ahora = 0;
    const cache = new CacheLocal(almacen, () => ahora);
    await cache.guardar('x', 1);

    ahora = MS_VIGENCIA;
    expect(await cache.leer('x')).not.toBeNull();
    ahora = MS_VIGENCIA + 1;
    expect(await cache.leer('x')).toBeNull();
  });

  it('un almacén roto o un contenido ilegible no tumban la consulta', async () => {
    const almacen = almacenDePrueba();
    const cache = new CacheLocal(almacen);
    almacen.datos.set('asta.cache.x', '{roto');
    expect(await cache.leer('x')).toBeNull();

    almacen.falla = true;
    expect(await cache.leer('x')).toBeNull();
    await expect(cache.guardar('y', 1)).resolves.toBeUndefined();
  });

  it('no crece sin límite: se van las entradas más viejas', async () => {
    const almacen = almacenDePrueba();
    let ahora = 0;
    const cache = new CacheLocal(almacen, () => ahora);
    for (let i = 0; i < MAX_ENTRADAS + 10; i++) {
      ahora += 1000;
      await cache.guardar(`e${i}`, i);
    }
    expect(almacen.datos.size).toBe(MAX_ENTRADAS);
    expect(await cache.leer('e0')).toBeNull();
    expect(await cache.leer(`e${MAX_ENTRADAS + 9}`)).not.toBeNull();
  });

  it('las claves ignoran mayúsculas, espacios y guiones, como la búsqueda', () => {
    expect(CLAVES.busqueda('HL-2350 ')).toBe(CLAVES.busqueda('hl 2350'));
    expect(CLAVES.compatibles(42)).toBe('compatibles.42');
  });
});

describe('#42 · Sin red se enseña lo guardado; con error del servidor, no', () => {
  it('primero vivo y se guarda; después sin red, sale lo guardado con su fecha', async () => {
    const almacen = almacenDePrueba();
    let ahora = 5_000_000;
    const cache = new CacheLocal(almacen, () => ahora);

    const viva = await buscarConCache({ ...config, fetch: async () => json(busquedaOk) }, cache, 'm404');
    expect(viva).toMatchObject({ ok: true, desdeCache: false, guardadoEn: null });

    ahora += 60_000;
    const sinRed = await buscarConCache({ ...config, fetch: async () => Promise.reject(new TypeError('offline')) }, cache, 'M404 ');
    expect(sinRed).toMatchObject({ ok: true, desdeCache: true, guardadoEn: 5_000_000 });
    expect(sinRed.ok && sinRed.datos.impresoras[0]?.id).toBe(7);
  });

  it('sin red y sin nada guardado, se dice que no hay red', async () => {
    const cache = new CacheLocal(almacenDePrueba());
    const r = await buscarConCache({ ...config, fetch: async () => Promise.reject(new TypeError('offline')) }, cache, 'nada');
    expect(r).toMatchObject({ ok: false, motivo: 'red', huboCache: false });
  });

  it('un 403 NO se tapa con la caché: la tablet está mal configurada y hay que verlo', async () => {
    const almacen = almacenDePrueba();
    const cache = new CacheLocal(almacen);
    await buscarConCache({ ...config, fetch: async () => json(busquedaOk) }, cache, 'm404');

    const r = await buscarConCache({ ...config, fetch: async () => json({ error: { code: 'INSUFFICIENT_SCOPE' } }, 403) }, cache, 'm404');
    expect(r).toMatchObject({ ok: false, motivo: 'permiso' });
  });

  it('un 404 tampoco: esa impresora ya no está', async () => {
    const almacen = almacenDePrueba();
    const cache = new CacheLocal(almacen);
    await compatiblesConCache({ ...config, fetch: async () => json({ data: [{ id: 1 }] }) }, cache, 42, null);

    const r = await compatiblesConCache({ ...config, fetch: async () => json({ error: {} }, 404) }, cache, 42, null);
    expect(r).toMatchObject({ ok: false, motivo: 'servidor', estado: 404 });
  });

  it('cada impresora tiene su propia caché', async () => {
    const cache = new CacheLocal(almacenDePrueba());
    await compatiblesConCache({ ...config, fetch: async () => json({ data: [{ id: 111 }] }) }, cache, 1, null);
    const otra = await compatiblesConCache({ ...config, fetch: async () => Promise.reject(new TypeError('offline')) }, cache, 2, null);
    expect(otra).toMatchObject({ ok: false, motivo: 'red' });
  });
});

describe('#42 · haceCuanto', () => {
  it('lo dice en minutos y en horas', () => {
    const t = 1_000_000_000;
    expect(haceCuanto(t, t + 20_000)).toBe('hace menos de un minuto');
    expect(haceCuanto(t, t + 3 * 60_000)).toBe('hace 3 min');
    expect(haceCuanto(t, t + 60 * 60_000)).toBe('hace 1 hora');
    expect(haceCuanto(t, t + 5 * 3600_000)).toBe('hace 5 horas');
    expect(haceCuanto(t, t - 10_000)).toBe('hace menos de un minuto');
  });
});

describe('#42 · Vigilante de conexión', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cambia a sin conexión, sondea, y al volver avisa y pide recargar UNA vez', async () => {
    const alCambiar = vi.fn();
    const alRecuperar = vi.fn();
    let responde = false;
    const v = crearVigilante({ comprobar: async () => responde, alCambiar, alRecuperar });

    v.reportar('sin_red');
    expect(v.estado()).toBe('sin_conexion');
    expect(alCambiar).toHaveBeenCalledWith('sin_conexion');

    await vi.advanceTimersByTimeAsync(MS_REINTENTO * 3);
    expect(v.estado()).toBe('sin_conexion');
    expect(alRecuperar).not.toHaveBeenCalled();

    responde = true;
    await vi.advanceTimersByTimeAsync(MS_REINTENTO);
    expect(v.estado()).toBe('conectado');
    expect(alRecuperar).toHaveBeenCalledTimes(1);
    expect(alCambiar).toHaveBeenLastCalledWith('conectado');
  });

  it('no avisa en cada petición: solo cuando cambia', () => {
    const alCambiar = vi.fn();
    const v = crearVigilante({ comprobar: async () => true, alCambiar, alRecuperar: vi.fn() });
    v.reportar('ok');
    v.reportar('ok');
    expect(alCambiar).not.toHaveBeenCalled();
    v.reportar('sin_red');
    v.reportar('sin_red');
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it('con la red buena no sondea: ni batería ni bitácora del servidor', async () => {
    const comprobar = vi.fn().mockResolvedValue(true);
    crearVigilante({ comprobar, alCambiar: vi.fn(), alRecuperar: vi.fn() });
    await vi.advanceTimersByTimeAsync(MS_REINTENTO * 10);
    expect(comprobar).not.toHaveBeenCalled();
  });

  it('parado deja de sondear', async () => {
    const comprobar = vi.fn().mockResolvedValue(false);
    const v = crearVigilante({ comprobar, alCambiar: vi.fn(), alRecuperar: vi.fn() });
    v.reportar('sin_red');
    await vi.advanceTimersByTimeAsync(MS_REINTENTO);
    const llamadas = comprobar.mock.calls.length;
    v.parar();
    await vi.advanceTimersByTimeAsync(MS_REINTENTO * 5);
    expect(comprobar.mock.calls.length).toBe(llamadas);
  });

  it('el ERP caído rescata de la caché y se ve distinto de la falta de red', async () => {
    // Es el corte más probable: Odoo cae y la tienda tiene wifi. Sin esto, la
    // tablet daría un error teniendo los datos guardados.
    const cache = new CacheLocal(almacenDePrueba());
    const alCambiar = vi.fn();
    const v = crearVigilante({ comprobar: async () => true, alCambiar, alRecuperar: vi.fn() });

    await compatiblesConCache({ ...config, fetch: async () => json({ data: [{ id: 9 }] }) }, cache, 42, null, v.reportar);

    const erpCaido = json({ error: { code: 'ODOO_UNAVAILABLE', message: 'El ERP no está respondiendo.' } }, 503);
    const r = await compatiblesConCache({ ...config, fetch: async () => erpCaido.clone() }, cache, 42, null, v.reportar);

    expect(r).toMatchObject({ ok: true, desdeCache: true });
    expect(v.estado()).toBe('sin_datos_vivos');
    expect(alCambiar).toHaveBeenLastCalledWith('sin_datos_vivos');
  });

  it('un 503 que NO es del ERP sigue siendo un error del servidor', async () => {
    const cache = new CacheLocal(almacenDePrueba());
    await compatiblesConCache({ ...config, fetch: async () => json({ data: [{ id: 9 }] }) }, cache, 42, null);
    const r = await compatiblesConCache({ ...config, fetch: async () => json({ error: { code: 'INTERNAL_ERROR' } }, 503) }, cache, 42, null);
    expect(r).toMatchObject({ ok: false, motivo: 'servidor', estado: 503 });
  });

  it('un 500 del servidor NO es falta de red: contestó', async () => {
    const alCambiar = vi.fn();
    const cache = new CacheLocal(almacenDePrueba());
    const v = crearVigilante({ comprobar: async () => true, alCambiar, alRecuperar: vi.fn() });

    await buscarConCache({ ...config, fetch: async () => json({ error: {} }, 500) }, cache, 'x', v.reportar);
    expect(v.estado()).toBe('conectado');
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
