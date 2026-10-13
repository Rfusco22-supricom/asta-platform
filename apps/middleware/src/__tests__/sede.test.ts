import { describe, expect, it } from 'vitest';
import { SEDES, nombreSede, sedeDe } from '@asta/shared-types';
import { SedeInvalida, claveSede, enSede, sedeDeLaPeticion } from '../services/sede.js';
import { deSede } from '../services/smartbit.service.js';

/*
 * Las estadísticas del administrador, por sede.
 *
 * Los ids son los de las compañías de Odoo, los mismos que usa el selector del
 * panel de SUPRICOM: si aquí Valencia fuera otra compañía, los dos paneles
 * volverían a dar cifras distintas para «Valencia».
 */

describe('sedes · cuáles hay', () => {
  it('Valencia, Caracas y Panamá, con sus compañías de Odoo', () => {
    expect(SEDES.map((s) => [s.id, s.nombre])).toEqual([
      [9, 'Valencia'],
      [10, 'Caracas'],
      [7, 'Panamá'],
    ]);
    expect(nombreSede(null)).toBe('Todas las sedes');
  });
});

describe('sedes · lo que llega en la URL', () => {
  it.each([undefined, null, '', 'todas'])('«%s» son todas las sedes', (valor) => {
    expect(sedeDe(valor)).toBeNull();
    expect(sedeDeLaPeticion({ sede: valor })).toBeNull();
  });

  it.each([
    ['9', 9],
    ['10', 10],
    ['7', 7],
  ])('«%s» es la sede %i', (valor, id) => {
    expect(sedeDeLaPeticion({ sede: valor })).toBe(id);
  });

  it.each(['1', '3', 'valencia', '9.5', '-9'])('«%s» es un 400, no «todas»', (valor) => {
    expect(sedeDe(valor)).toBeUndefined();
    expect(() => sedeDeLaPeticion({ sede: valor })).toThrow(SedeInvalida);
    try {
      sedeDeLaPeticion({ sede: valor });
    } catch (e) {
      expect((e as SedeInvalida).status).toBe(400);
    }
  });
});

describe('sedes · cómo filtra', () => {
  it('en Odoo, por la compañía; sin sede, nada', () => {
    expect(enSede(9)).toEqual([['company_id', '=', 9]]);
    expect(enSede(null)).toEqual([]);
  });

  it('en Smartbit, por el company_id de la fila', () => {
    expect(deSede({ companyId: 9 }, 9)).toBe(true);
    expect(deSede({ companyId: 10 }, 9)).toBe(false);
    expect(deSede({ companyId: 10 }, null)).toBe(true);
  });

  it('la clave de cache distingue cada sede de «todas»', () => {
    expect(new Set([claveSede(null), ...SEDES.map((s) => claveSede(s.id))]).size).toBe(SEDES.length + 1);
  });
});
