import { afterEach, describe, expect, it } from 'vitest';
import { dominioInventario, estadoDeStock, umbralStockBajo } from '../services/inventory.service.js';
import { CacheTtl } from '../utils/cacheTtl.js';

/**
 * Las piezas de #30 que no necesitan Odoo.
 *
 * `inventario.test.ts` contrasta los estados contra los quants, pero lo hace con
 * el mismo `estadoDeStock` que usa el servicio: si los bordes del umbral
 * estuvieran mal, los dos lados se equivocarían igual. Los bordes se fijan aquí.
 */

describe('#30 · estadoDeStock', () => {
  afterEach(() => {
    delete process.env.INVENTARIO_UMBRAL_BAJO;
  });

  it('bordes con el umbral por defecto (5)', () => {
    expect(umbralStockBajo()).toBe(5);
    expect(estadoDeStock(-3)).toBe('agotado'); // más reservado que físico
    expect(estadoDeStock(0)).toBe('agotado');
    expect(estadoDeStock(0.5)).toBe('bajo');
    expect(estadoDeStock(5)).toBe('bajo');
    expect(estadoDeStock(5.01)).toBe('disponible');
  });

  it('el umbral se configura por entorno, y un valor inválido no lo anula', () => {
    process.env.INVENTARIO_UMBRAL_BAJO = '20';
    expect(estadoDeStock(20)).toBe('bajo');
    expect(estadoDeStock(21)).toBe('disponible');

    for (const invalido of ['0', '-4', 'abc', '']) {
      process.env.INVENTARIO_UMBRAL_BAJO = invalido;
      expect(umbralStockBajo()).toBe(5);
    }
  });
});

describe('#30 · dominioInventario', () => {
  it('siempre filtra vendible, almacenable y compañía, con o sin filtros del cliente', () => {
    for (const consulta of [{ soloDisponibles: false }, { sku: 'X', q: 'toner', soloDisponibles: true }]) {
      const d = dominioInventario(consulta, 9);
      expect(d).toContainEqual(['sale_ok', '=', true]);
      expect(d).toContainEqual(['detailed_type', '=', 'product']);
      expect(d).toContainEqual(['company_id', 'in', [false, 9]]);
    }
  });

  it('q busca en nombre O referencia, sin tragarse el resto del dominio', () => {
    // En notación polaca, un '|' mal colocado convierte "A y B y (C o D)" en
    // "(A y B y C) o D": el catálogo entero de lo que coincida con D.
    const d = dominioInventario({ q: 'hp', soloDisponibles: false }, 9);
    expect(d.slice(-3)).toEqual(['|', ['name', 'ilike', 'hp'], ['default_code', 'ilike', 'hp']]);
  });
});

describe('#30 · CacheTtl', () => {
  it('caduca', () => {
    let t = 1000;
    const c = new CacheTtl<number>(60_000, 10, () => t);
    c.set('k', 1);
    t += 59_999;
    expect(c.get('k')).toBe(1);
    t += 1;
    expect(c.get('k')).toBeUndefined();
  });

  it('no crece sin límite: descarta la más antigua', () => {
    // La clave lleva lo que manda el cliente (q, sku): sin tope, cualquiera la
    // llenaría de búsquedas distintas.
    const c = new CacheTtl<number>(60_000, 3);
    for (let i = 0; i < 10; i++) c.set(`q${i}`, i);
    expect(c.tamanio).toBe(3);
    expect(c.get('q0')).toBeUndefined();
    expect(c.get('q9')).toBe(9);
  });
});
