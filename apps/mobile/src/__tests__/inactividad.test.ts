import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearTemporizador, MS_INACTIVIDAD } from '../inactividad.js';

/**
 * #40 · Volver a la atracción tras un minuto sin tocar.
 *
 * Con el reloj parado: un test que espere un minuto de verdad no lo ejecuta
 * nadie.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('#40 · crearTemporizador', () => {
  it('vence tras el tiempo dado, una sola vez', () => {
    const alVencer = vi.fn();
    crearTemporizador(MS_INACTIVIDAD, alVencer);

    vi.advanceTimersByTime(MS_INACTIVIDAD - 1);
    expect(alVencer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(alVencer).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MS_INACTIVIDAD * 3);
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it('cada toque vuelve a empezar la cuenta', () => {
    const alVencer = vi.fn();
    const t = crearTemporizador(1000, alVencer);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900);
      t.reiniciar();
    }
    expect(alVencer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it('parado ya no vence, y pararlo dos veces no rompe', () => {
    const alVencer = vi.fn();
    const t = crearTemporizador(1000, alVencer);
    t.parar();
    t.parar();
    vi.advanceTimersByTime(5000);
    expect(alVencer).not.toHaveBeenCalled();
  });

  it('el minuto es el que dice la constante', () => {
    expect(MS_INACTIVIDAD).toBe(60_000);
  });
});
