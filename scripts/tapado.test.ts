import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Las reglas del modo presentación del panel (`apps/web/public/tapado.js`).
 *
 * El script corre en el navegador, sin módulos: se carga aquí tal cual, sin
 * `document`, y deja sus reglas en el contexto. Lo que se prueba es lo que
 * fallaría en silencio: un importe con otra forma que se queda a la vista.
 */

const ctx: { tapado?: { trozos: (t: string, conNumeros?: boolean) => Array<[number, number]>; COLUMNAS: RegExp; esCifra: (t: string, enCelda: boolean) => boolean } } = {};
runInNewContext(readFileSync(new URL('../apps/web/public/tapado.js', import.meta.url), 'utf8'), ctx);
const { trozos, COLUMNAS, esCifra } = ctx.tapado!;

/** Lo que queda tapado de un texto, en orden. */
const tapa = (texto: string, conNumeros = false) => trozos(texto, conNumeros).map(([a, b]) => texto.slice(a, b));

describe('importes', () => {
  it('con decimales, enteros, abreviados y negativos', () => {
    expect(tapa('Total $1.234,56')).toEqual(['$1.234,56']);
    expect(tapa('$28.312')).toEqual(['$28.312']);
    expect(tapa('vendido $53,1 mil este mes')).toEqual(['$53,1 mil']);
    expect(tapa('$2,2 M')).toEqual(['$2,2 M']);
    expect(tapa('saldo −$305,10')).toEqual(['−$305,10']);
  });

  it('dentro de una frase, todos', () => {
    expect(tapa('Te faltan $545 para entrar; el típico compra $168 al año.')).toEqual(['$545', '$168']);
  });

  it('«M» solo si es la palabra: no se come la que sigue', () => {
    expect(tapa('$12 Marcas')).toEqual(['$12']);
  });

  it('sin «$» ni unidad no es una cifra de la empresa', () => {
    expect(tapa('Puesto 1 de 229 en Carabobo')).toEqual([]);
    expect(tapa('TONER CE278A/285')).toEqual([]);
    expect(tapa('3 de 3 encendidas')).toEqual([]);
  });
});

describe('cantidades', () => {
  it('con su unidad, también el «N de M»', () => {
    expect(tapa('dic 2025 – hoy · 1.405 facturas')).toEqual(['1.405 facturas']);
    expect(tapa('Oro · 4 de 12 clientes')).toEqual(['4 de 12 clientes']);
    expect(tapa('13.456 u. · 226 clientes')).toEqual(['13.456 u.', '226 clientes']);
    expect(tapa('cotizado −44 % · 21 productos en riesgo')).toEqual(['44 %', '21 productos']);
    expect(tapa('1 factura')).toEqual(['1 factura']);
  });

  it('en una baldosa, cualquier número suelto, sin pisarse con los demás', () => {
    expect(tapa('497 de 548 ya son pedido', true)).toEqual(['497', '548']);
    expect(tapa('$1.200 en 12 facturas', true)).toEqual(['$1.200', '12 facturas']);
    expect(tapa('TONER W1500A', true)).toEqual([]);
  });

  it('no se come las palabras que empiezan igual', () => {
    expect(tapa('12 clientela')).toEqual([]);
  });
});

describe('contacto', () => {
  it('correos', () => {
    expect(tapa('Enlace para compras@tienda.com.ve')).toEqual(['compras@tienda.com.ve']);
  });

  it('RIF, con y sin guiones', () => {
    expect(tapa('RIF J-12345678-9')).toEqual(['J-12345678-9']);
    expect(tapa('V12345678')).toEqual(['V12345678']);
    expect(tapa('mismo RIF · 89691806')).toEqual(['89691806']);
  });

  it('teléfonos de Venezuela', () => {
    expect(tapa('Llama al 0414-1234567')).toEqual(['0414-1234567']);
    expect(tapa('+58 212 555 12 34')).toEqual(['+58 212 555 12 34']);
  });
});

describe('tablas', () => {
  it('las columnas que llevan personas', () => {
    for (const c of ['Cliente', 'Clientes', 'Vendedor', 'Cartera', 'Persona', 'Usuario de Odoo', 'Correo', 'RIF', 'Teléfono']) expect(COLUMNAS.test(c)).toBe(true);
    for (const c of ['Producto', 'Estado', 'Compañía', 'Nivel']) expect(COLUMNAS.test(c)).toBe(false);
  });

  it('un texto que es solo una cifra', () => {
    for (const c of ['12', '1.234', '45,5 %', '403 u.', '−3']) expect(esCifra(c, true)).toBe(true);
    for (const c of ['oct 26', 'Oro', '11 de 12', '2026']) expect(esCifra(c, true)).toBe(false);
  });

  it('fuera de una tabla, un puesto de una sola cifra se ve', () => {
    expect(esCifra('3', false)).toBe(false);
    expect(esCifra('22', false)).toBe(true);
    expect(esCifra('7 %', false)).toBe(true);
  });
});
