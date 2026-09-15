import { describe, expect, it } from 'vitest';
import { mesesDe, mesDelGrupo } from '../services/reportes.service.js';
import { rangoDeLaPeticion, ultimosDoceMeses, RangoInvalido } from '../services/rango.js';

/**
 * La parte del reporte que se puede equivocar en silencio.
 *
 * Los totales se comprueban contra Odoo —y se comprobaron: 3.929.439,24 para el
 * primer trimestre de 2026, idéntico pidiéndoselo al ERP directamente—. Lo que
 * cubre este fichero es lo otro: el etiquetado de los meses y la validación del
 * rango, que si fallan devuelven un número perfectamente creíble y equivocado.
 */

describe('de qué mes es un grupo de Odoo', () => {
  /*
   * El caso que motivó la función, medido contra la instancia real.
   *
   * Odoo adjunta a cada grupo un `__domain` con DOS cláusulas `invoice_date >=`:
   * la del rango que pidió el reporte y la del mes del grupo. Quedarse con la
   * primera etiquetaba febrero y marzo como enero, y la serie entera se apilaba
   * en el primer mes sin que nada fallara.
   */
  const febreroReal = {
    __domain: [
      '&',
      '&',
      '&',
      '&',
      ['move_type', 'in', ['out_invoice']],
      ['state', '=', 'posted'],
      ['invoice_date', '>=', '2026-01-01'],
      ['invoice_date', '<=', '2026-03-31'],
      '&',
      ['invoice_date', '>=', '2026-02-01'],
      ['invoice_date', '<', '2026-03-01'],
    ],
  };

  it('coge el mes del grupo, no el principio del rango pedido', () => {
    expect(mesDelGrupo(febreroReal)).toBe('2026-02');
  });

  it('funciona cuando el rango es un solo mes y las dos fechas coinciden', () => {
    expect(
      mesDelGrupo({
        __domain: [
          ['invoice_date', '>=', '2026-02-01'],
          ['invoice_date', '<=', '2026-02-28'],
          ['invoice_date', '>=', '2026-02-01'],
          ['invoice_date', '<', '2026-03-01'],
        ],
      }),
    ).toBe('2026-02');
  });

  it('no se inventa un mes si Odoo no manda el dominio', () => {
    // Antes que etiquetar mal, la serie prefiere no contar ese grupo.
    expect(mesDelGrupo({})).toBeNull();
    expect(mesDelGrupo({ __domain: 'cualquier cosa' })).toBeNull();
    expect(mesDelGrupo({ __domain: [['state', '=', 'posted']] })).toBeNull();
  });

  it('NO usa la etiqueta que trae Odoo, que viene traducida', () => {
    // La instancia real devuelve «enero 2026». Si alguien cambiara la función
    // para leer ese texto, esto lo pillaría: aquí la etiqueta miente a propósito.
    const grupo = {
      'invoice_date:month': 'diciembre 2025',
      __domain: [['invoice_date', '>=', '2026-02-01']],
    };
    expect(mesDelGrupo(grupo)).toBe('2026-02');
  });
});

describe('los meses de un rango', () => {
  it('no se salta ninguno', () => {
    expect(mesesDe({ desde: '2025-11-01', hasta: '2026-02-28' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('un rango dentro de un mismo mes da ese mes', () => {
    expect(mesesDe({ desde: '2026-03-05', hasta: '2026-03-20' })).toEqual(['2026-03']);
  });

  it('no se desboca con un rango absurdo', () => {
    // La serie alimenta una gráfica: sin cota, un rango de siglos la cuelga.
    expect(mesesDe({ desde: '1900-01-01', hasta: '2999-12-31' }).length).toBe(120);
  });
});

describe('el rango que llega por la URL', () => {
  const hoy = new Date('2026-09-15T10:00:00Z');

  it('sin parámetros, los últimos doce meses', () => {
    const r = rangoDeLaPeticion({}, hoy);
    expect(r).toEqual({ desde: '2025-10-01', hasta: '2026-09-15' });
    expect(mesesDe(r)).toHaveLength(12);
  });

  it('ultimosDoceMeses arranca el día 1, para que el primer mes salga entero', () => {
    expect(ultimosDoceMeses(hoy).desde).toBe('2025-10-01');
  });

  it('acepta un rango explícito', () => {
    expect(rangoDeLaPeticion({ desde: '2026-01-01', hasta: '2026-03-31' }, hoy)).toEqual({
      desde: '2026-01-01',
      hasta: '2026-03-31',
    });
  });

  it('con una sola fecha falla, en vez de inventarse la otra', () => {
    // Un reporte que dice «desde enero» y suma otra cosa es peor que uno que no
    // sale: el número es creíble y nadie lo comprueba.
    expect(() => rangoDeLaPeticion({ desde: '2026-01-01' }, hoy)).toThrow(RangoInvalido);
    expect(() => rangoDeLaPeticion({ hasta: '2026-03-31' }, hoy)).toThrow(RangoInvalido);
  });

  it('rechaza lo que no es una fecha', () => {
    expect(() => rangoDeLaPeticion({ desde: 'ayer', hasta: 'hoy' }, hoy)).toThrow(RangoInvalido);
    expect(() => rangoDeLaPeticion({ desde: '01/01/2026', hasta: '31/03/2026' }, hoy)).toThrow(
      RangoInvalido,
    );
  });

  it('rechaza una fecha con formato bueno que no existe', () => {
    expect(() => rangoDeLaPeticion({ desde: '2026-02-31', hasta: '2026-03-31' }, hoy)).toThrow(
      RangoInvalido,
    );
  });

  it('rechaza el rango al revés', () => {
    expect(() => rangoDeLaPeticion({ desde: '2026-03-31', hasta: '2026-01-01' }, hoy)).toThrow(
      RangoInvalido,
    );
  });

  it('corta en cinco años', () => {
    // El `read_group` sobre un rango enorme es de los que se van al timeout de
    // 30 s de Odoo. Mejor un mensaje que una petición que muere a mitad.
    expect(() => rangoDeLaPeticion({ desde: '2000-01-01', hasta: '2026-01-01' }, hoy)).toThrow(
      RangoInvalido,
    );
    expect(() =>
      rangoDeLaPeticion({ desde: '2021-09-01', hasta: '2026-09-01' }, hoy),
    ).not.toThrow();
  });

  it('el error lleva el código que el manejador convierte en 400', () => {
    try {
      rangoDeLaPeticion({ desde: 'x', hasta: 'y' }, hoy);
      expect.unreachable('tenía que lanzar');
    } catch (e) {
      expect((e as RangoInvalido).code).toBe('INVALID_DATE_RANGE');
    }
  });
});
