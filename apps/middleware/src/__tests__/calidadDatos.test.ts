import { describe, expect, it } from 'vitest';
import { digitoVerificador, problemaRif, problemasNombreVendedor, tieneEspaciosDeMas } from '../services/calidadDatos.js';

/**
 * Las comprobaciones de «Calidad de datos». Los RIF son de forma real; los
 * dígitos verificadores, calculados a mano con la tabla del SENIAT.
 */

describe('problemaRif', () => {
  it('acepta un RIF con el dígito verificador bien, se escriba como se escriba', () => {
    // J-00000000-?: suma = 3·4 = 12 → 11 − 1 = 10 → 0.
    expect(digitoVerificador('J', '00000000')).toBe(0);
    expect(problemaRif('J-00000000-0')).toBeNull();
    expect(problemaRif('j000000000')).toBeNull();
    // J-12345678-?: 12 + 3+4+21+24+25+24+21+16 = 150 → 11 − 7 = 4.
    expect(problemaRif('J-12345678-4')).toBeNull();
  });

  it('una cédula sin dígito verificador es válida', () => {
    expect(problemaRif('V8844782')).toBeNull();
    expect(problemaRif('V-12.345.678')).toBeNull();
    expect(problemaRif('E-845123')).toBeNull();
  });

  it('dice qué tiene mal cada uno', () => {
    expect(problemaRif(false)).toBe('Sin RIF');
    expect(problemaRif('  ')).toBe('Sin RIF');
    expect(problemaRif('J-12345678-5')).toMatch(/dígito verificador no cuadra \(con estas cifras sería 4\)/);
    expect(problemaRif('J3294098229')).toMatch(/10 cifras/);
    expect(problemaRif('J-1234567')).toMatch(/7 cifras/);
    // Un RUC panameño en una compañía venezolana.
    expect(problemaRif('8-887-898')).toMatch(/no tiene forma de RIF/);
    expect(problemaRif('DISAVEN IMPORT, C.A')).toMatch(/no tiene forma de RIF/);
  });
});

describe('nombres', () => {
  it('espacios de más', () => {
    expect(tieneEspaciosDeMas('TONERES DEMO  S A')).toBe(true);
    expect(tieneEspaciosDeMas('OFITEC ')).toBe(true);
    expect(tieneEspaciosDeMas(' OFITEC')).toBe(true);
    expect(tieneEspaciosDeMas('OFITEC, C.A.')).toBe(false);
  });

  it('nombre de vendedor', () => {
    expect(problemasNombreVendedor('Ana Pérez')).toEqual([]);
    expect(problemasNombreVendedor('Luis Mora (v)')).toEqual(['lleva «(v)» al final']);
    expect(problemasNombreVendedor('Rosa Díaz (V)')).toEqual(['lleva «(v)» al final']);
    expect(problemasNombreVendedor('CARLA PEÑA.')).toEqual(['termina en un signo de puntuación', 'está todo en mayúsculas']);
    expect(problemasNombreVendedor('MARTA  RUIZ')).toEqual(['tiene espacios de más', 'está todo en mayúsculas']);
    expect(problemasNombreVendedor('Asistente de Ventas CCS')).toEqual(['es un puesto, no una persona']);
  });
});
