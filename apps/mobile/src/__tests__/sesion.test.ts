import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearSesion, MS_AVISO_ANTES, MS_SESION } from '../sesion.js';

/**
 * #41 · La sesión del kiosco, con el reloj parado.
 *
 * Lo que se vigila: que se cierre sola a los 4 minutos, que avise 30 segundos
 * antes, que cualquier toque lo reinicie todo, y que una sesión cerrada esté
 * cerrada —ni avisa ni cierra dos veces— porque de eso depende que no quede
 * nada del cliente anterior en pantalla.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const espias = () => ({ alAvisar: vi.fn(), alCerrar: vi.fn() });

describe('#41 · Cierre por inactividad', () => {
  it('avisa a los 3:30 y cierra a los 4:00', () => {
    const e = espias();
    crearSesion(e);

    vi.advanceTimersByTime(MS_SESION - MS_AVISO_ANTES - 1);
    expect(e.alAvisar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(e.alAvisar).toHaveBeenCalledWith(true);
    expect(e.alCerrar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MS_AVISO_ANTES - 1);
    expect(e.alCerrar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(e.alCerrar).toHaveBeenCalledWith('timeout');
  });

  it('los tiempos son los de #41', () => {
    expect([MS_SESION, MS_AVISO_ANTES]).toEqual([4 * 60_000, 30_000]);
  });

  it('un toque reinicia los dos relojes', () => {
    const e = espias();
    const s = crearSesion(e);
    // Justo antes del aviso: así se comprueba que ninguno de los dos relojes
    // llega a saltar mientras alguien usa la tablet.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(MS_SESION - MS_AVISO_ANTES - 1000);
      s.tocar();
    }
    expect(e.alCerrar).not.toHaveBeenCalled();
    expect(e.alAvisar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MS_SESION);
    expect(e.alCerrar).toHaveBeenCalledTimes(1);
  });

  it('«Sigo aquí» quita el aviso y devuelve los cuatro minutos enteros', () => {
    const e = espias();
    const s = crearSesion(e);

    vi.advanceTimersByTime(MS_SESION - MS_AVISO_ANTES);
    expect(e.alAvisar).toHaveBeenLastCalledWith(true);

    s.tocar();
    expect(e.alAvisar).toHaveBeenLastCalledWith(false);

    vi.advanceTimersByTime(MS_SESION - MS_AVISO_ANTES - 1);
    expect(e.alAvisar).toHaveBeenCalledTimes(2); // no ha vuelto a avisar
    vi.advanceTimersByTime(MS_AVISO_ANTES + 1);
    expect(e.alCerrar).toHaveBeenCalledTimes(1);
  });
});

describe('#41 · Terminar a mano', () => {
  it('cierra con motivo logout, sin esperar', () => {
    const e = espias();
    const s = crearSesion(e);
    vi.advanceTimersByTime(1000);
    s.terminar();
    expect(e.alCerrar).toHaveBeenCalledWith('logout');
  });

  it('una sesión cerrada no vuelve a cerrar ni a avisar', () => {
    const e = espias();
    const s = crearSesion(e);
    s.terminar();
    s.terminar();
    s.tocar();
    vi.advanceTimersByTime(MS_SESION * 3);
    expect(e.alCerrar).toHaveBeenCalledTimes(1);
    expect(e.alAvisar).not.toHaveBeenCalled();
  });

  it('terminar con el aviso en pantalla lo retira', () => {
    const e = espias();
    const s = crearSesion(e);
    vi.advanceTimersByTime(MS_SESION - MS_AVISO_ANTES);
    s.terminar();
    expect(e.alAvisar).toHaveBeenLastCalledWith(false);
    expect(e.alCerrar).toHaveBeenCalledWith('logout');
  });
});

describe('#41 · Parar desde fuera', () => {
  it('no cierra ni avisa: la pantalla ya cambió', () => {
    const e = espias();
    const s = crearSesion(e);
    s.parar();
    vi.advanceTimersByTime(MS_SESION * 2);
    expect(e.alCerrar).not.toHaveBeenCalled();
    expect(e.alAvisar).not.toHaveBeenCalled();
  });
});
