import { describe, expect, it } from 'vitest';
import { limpiarEspacios, nombrePersona } from '@asta/shared-types';

/** Cómo se enseñan los nombres de Odoo. Los nombres son inventados, con las mismas manías que los reales. */

describe('nombrePersona', () => {
  it.each([
    ['MARTA  RUIZ', 'Marta Ruiz'],
    ['Luis Mora (v)', 'Luis Mora'],
    ['Rosa Díaz (V)', 'Rosa Díaz'],
    ['CARLA PEÑA.', 'Carla Peña'],
    ['ANGEL MOTA RODRIGUEZ ', 'Angel Mota Rodriguez'],
    ['MARIA DE LOS ANGELES PEREZ', 'Maria de los Angeles Perez'],
    ['JOSE-LUIS ÑAÑEZ', 'Jose-Luis Ñañez'],
    ['DE LA CRUZ', 'De la Cruz'],
  ])('«%s» → «%s»', (crudo, visto) => expect(nombrePersona(crudo)).toBe(visto));

  it('lo que ya tiene minúsculas se respeta', () => {
    expect(nombrePersona('Asistente de Ventas CCS')).toBe('Asistente de Ventas CCS');
    expect(nombrePersona('Ana McKenzie')).toBe('Ana McKenzie');
  });

  it('no se queda vacío', () => {
    expect(nombrePersona('(v)')).toBe('(v)');
    expect(nombrePersona('  ')).toBe('');
  });
});

describe('limpiarEspacios', () => {
  it('quita los dobles y los de los bordes, y no toca mayúsculas', () => {
    expect(limpiarEspacios('  WORLD SHOP &  PTO. ORDAZ, C.A. ')).toBe('WORLD SHOP & PTO. ORDAZ, C.A.');
  });
});
