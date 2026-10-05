import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { programarAlertas } from '../services/pasadaAlertas.service.js';

/**
 * #46 · Las alertas desde el propio middleware, cada pocos minutos.
 *
 * Lo que tiene que cumplir un programador que vive dentro del servidor: que no
 * empiece nada más arrancar, que repita, que una pasada lenta no se amontone
 * con la siguiente, y que un error no lo pare para siempre.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('programarAlertas', () => {
  it('espera la primera, y luego repite cada intervalo', async () => {
    const lineas: string[] = [];
    let pasadas = 0;
    const p = programarAlertas(async () => `pasada ${++pasadas}`, { cadaMs: 5_000, primeraEnMs: 2_000, escribir: (l) => lineas.push(l) });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(pasadas).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pasadas).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pasadas).toBe(3);
    expect(lineas).toEqual(['pasada 1', 'pasada 2', 'pasada 3']);

    p.parar();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pasadas).toBe(3);
  });

  it('una pasada más lenta que el intervalo no se amontona: la siguiente se salta', async () => {
    const lineas: string[] = [];
    let empezadas = 0;
    const p = programarAlertas(
      async () => {
        empezadas++;
        await new Promise((r) => setTimeout(r, 12_000));
        return 'terminó';
      },
      { cadaMs: 5_000, primeraEnMs: 0, escribir: (l) => lineas.push(l) },
    );
    await vi.advanceTimersByTimeAsync(11_000);
    expect(empezadas).toBe(1);
    expect(lineas.filter((l) => l.includes('se salta'))).toHaveLength(2);
    p.parar();
  });

  it('un error se escribe y la siguiente pasada vuelve a intentarlo', async () => {
    const lineas: string[] = [];
    let n = 0;
    const p = programarAlertas(
      async () => {
        if (++n === 1) throw new Error('MySQL no responde');
        return 'bien';
      },
      { cadaMs: 5_000, primeraEnMs: 0, escribir: (l) => lineas.push(l) },
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lineas).toEqual(['alertas: la pasada falló: MySQL no responde', 'bien']);
    p.parar();
  });
});
