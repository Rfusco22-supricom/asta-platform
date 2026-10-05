import { describe, expect, it } from 'vitest';
import { leerCsv } from '../utils/csv.js';

/**
 * #56 · El CSV que vuelve de Excel.
 *
 * El archivo de propuestas lo abre y lo guarda una persona. Lo que Excel hace al
 * guardar —`;` en configuración española, BOM, `\r\n`, comillas— no puede
 * convertir una decisión en otra columna ni perder una fila.
 */

describe('#56 · leerCsv', () => {
  it('coma, sin adornos', () => {
    expect(leerCsv('a,b\n1,2\n')).toEqual([{ linea: 2, campos: { a: '1', b: '2' } }]);
  });

  it('Excel en español: punto y coma, BOM y CRLF', () => {
    const texto = '\uFEFFodoo_product_tmpl_id;marca;codigo;decision\r\n108024;Canon;PG-145XL;VALIDADA\r\n108037;Canon;CL-146XL;\r\n';
    expect(leerCsv(texto)).toEqual([
      { linea: 2, campos: { odoo_product_tmpl_id: '108024', marca: 'Canon', codigo: 'PG-145XL', decision: 'VALIDADA' } },
      { linea: 3, campos: { odoo_product_tmpl_id: '108037', marca: 'Canon', codigo: 'CL-146XL', decision: '' } },
    ]);
  });

  it('comillas con separador, comillas dobladas y salto de línea dentro', () => {
    const texto = 'nombre,nota\n"ASTA TONER CB435A/CB436A, 285","dice ""compatible""\ny otra línea"\nsiguiente,x\n';
    const filas = leerCsv(texto);
    expect(filas[0].campos).toEqual({ nombre: 'ASTA TONER CB435A/CB436A, 285', nota: 'dice "compatible"\ny otra línea' });
    // La fila con el salto de línea dentro empieza en la 2; la siguiente, en la 4.
    expect(filas.map((f) => f.linea)).toEqual([2, 4]);
  });

  it('una celda con ; dentro de un archivo con coma no parte la fila', () => {
    expect(leerCsv('a,b\n"x;y",z')[0].campos).toEqual({ a: 'x;y', b: 'z' });
  });

  it('cabeceras con espacios y mayúsculas, líneas vacías al final, última fila sin salto', () => {
    expect(leerCsv(' Decision , NOTA \nVALIDADA,ok\n\n\n')).toEqual([{ linea: 2, campos: { decision: 'VALIDADA', nota: 'ok' } }]);
    expect(leerCsv('a\n1')).toEqual([{ linea: 2, campos: { a: '1' } }]);
  });

  it('comillas sin cerrar → error con la línea, no una fila rara', () => {
    expect(() => leerCsv('a,b\n"sin cerrar,2\n')).toThrow(/comillas sin cerrar.*línea 2/);
  });

  it('un archivo vacío no tiene filas', () => {
    expect(leerCsv('')).toEqual([]);
  });
});
