import { describe, it, expect, afterEach } from 'vitest';
import { version } from '../config/version.js';

/**
 * La versión existe para contestar «¿qué build corre?» cuando algo no cuadra.
 * Lo que se prueba aquí es justamente eso: que conteste SIEMPRE algo útil,
 * incluso cuando nadie configuró el sha — que es el caso en que se necesita.
 */
describe('version()', () => {
  const original = process.env.VERSION_SHA;

  afterEach(() => {
    if (original === undefined) delete process.env.VERSION_SHA;
    else process.env.VERSION_SHA = original;
  });

  it('devuelve el sha cuando el build lo recibió', () => {
    process.env.VERSION_SHA = '559cb0d';
    expect(version().sha).toBe('559cb0d');
  });

  it('le quita los espacios: un build arg vacío llega como " " más de una vez', () => {
    process.env.VERSION_SHA = '  559cb0d\n';
    expect(version().sha).toBe('559cb0d');
  });

  it('sin VERSION_SHA da null, no la cadena vacía', () => {
    delete process.env.VERSION_SHA;
    expect(version().sha).toBeNull();
  });

  it('un VERSION_SHA en blanco cuenta como no puesto', () => {
    // `ARG VERSION_SHA=""` en el Dockerfile llega así cuando no se pasa nada.
    process.env.VERSION_SHA = '   ';
    expect(version().sha).toBeNull();
  });

  it('la fecha del build sale sin configurar nada', () => {
    // Es la mitad que no se puede olvidar: aunque el sha falte, esto distingue
    // una imagen vieja de una nueva.
    delete process.env.VERSION_SHA;
    const { construido } = version();
    expect(construido).not.toBeNull();
    expect(new Date(construido!).getTime()).toBeGreaterThan(0);
  });
});
