import { describe, expect, it, vi } from 'vitest';
import { buscarImpresoras, compatiblesDe, registrarClic, type Config } from '../api.js';

/**
 * #40 · El cliente de la API del kiosco.
 *
 * Lo que importa: que una tablet sin conexión o con una key mal puesta no
 * reviente delante del cliente, y que cada fallo se distinga para poder decir
 * algo útil en pantalla.
 */

const respuesta = (estado: number, cuerpo?: unknown) =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });

const config = (f: typeof fetch): Config => ({ base: 'https://api.example', apiKey: 'asta_live_x', fetch: f });

describe('#40 · buscarImpresoras', () => {
  it('manda la key, la consulta y el tope, y devuelve impresoras, sugerencias y busquedaId', async () => {
    const f = vi.fn().mockResolvedValue(
      respuesta(200, { data: [{ id: 1, marca: 'HP', nombre: 'M404dn' }], sugerencias: [], meta: { busquedaId: '77' } }),
    );
    const r = await buscarImpresoras(config(f), 'hl 2350');

    expect(f.mock.lastCall?.[0]).toBe('https://api.example/api/v1/public/recommender/printers?q=hl%202350&limit=12');
    expect((f.mock.lastCall?.[1] as RequestInit).headers).toMatchObject({ 'X-API-Key': 'asta_live_x' });
    expect(r).toEqual({ ok: true, datos: { impresoras: [{ id: 1, marca: 'HP', nombre: 'M404dn' }], sugerencias: [], busquedaId: '77' } });
  });

  it('sin conexión → "red", no una excepción', async () => {
    const r = await buscarImpresoras(config(vi.fn().mockRejectedValue(new TypeError('Network request failed'))), 'hp');
    expect(r).toEqual({ ok: false, motivo: 'red' });
  });

  it('401 y 403 son "permiso": la tablet está mal configurada, no es un fallo del cliente', async () => {
    for (const estado of [401, 403]) {
      const r = await buscarImpresoras(config(vi.fn().mockResolvedValue(respuesta(estado, { error: { code: 'x' } }))), 'hp');
      expect(r).toEqual({ ok: false, motivo: 'permiso', estado });
    }
  });

  it('500 y una respuesta que no es JSON son "servidor"', async () => {
    expect(await buscarImpresoras(config(vi.fn().mockResolvedValue(respuesta(500, { error: {} }))), 'hp')).toEqual({ ok: false, motivo: 'servidor', estado: 500 });
    const rota = new Response('<html>', { status: 200, headers: { 'Content-Type': 'application/json' } });
    expect(await buscarImpresoras(config(vi.fn().mockResolvedValue(rota)), 'hp')).toMatchObject({ ok: false, motivo: 'servidor' });
  });
});

describe('#40 · compatiblesDe', () => {
  it('enlaza la consulta con la búsqueda cuando hay busquedaId', async () => {
    const f = vi.fn().mockResolvedValue(respuesta(200, { data: [] }));
    await compatiblesDe(config(f), 42, '77');
    expect(f.mock.lastCall?.[0]).toBe('https://api.example/api/v1/public/recommender/printers/42/compatible?busquedaId=77');
  });

  it('sin busquedaId no inventa el parámetro', async () => {
    const f = vi.fn().mockResolvedValue(respuesta(200, { data: [] }));
    await compatiblesDe(config(f), 42, null);
    expect(f.mock.lastCall?.[0]).toBe('https://api.example/api/v1/public/recommender/printers/42/compatible');
  });
});

describe('#40 · registrarClic', () => {
  it('manda el producto en un POST con cuerpo JSON', async () => {
    const f = vi.fn().mockResolvedValue(respuesta(204));
    registrarClic(config(f), '77', 2001);
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    const [url, opciones] = f.mock.lastCall as [string, RequestInit];
    expect(url).toBe('https://api.example/api/v1/public/recommender/busquedas/77/clic');
    expect([opciones.method, opciones.body]).toEqual(['POST', '{"productId":2001}']);
  });

  it('sin busquedaId no llama a nadie', () => {
    const f = vi.fn();
    registrarClic(config(f), null, 2001);
    expect(f).not.toHaveBeenCalled();
  });

  it('si la telemetría falla, no lanza: el cliente no se entera', async () => {
    const f = vi.fn().mockRejectedValue(new Error('caída'));
    expect(() => registrarClic(config(f), '77', 2001)).not.toThrow();
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
  });
});
