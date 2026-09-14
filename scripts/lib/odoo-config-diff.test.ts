import { describe, expect, it } from 'vitest';
import { comparar, valor, type Copia, type ReglaPrecio, type Tarifa } from './odoo-config-diff.js';

/**
 * Comparación de copias de la configuración de Odoo (#48).
 *
 * Se prueba la lógica pura, sin ficheros ni Odoo. La comparación es lo único que
 * hace útil al respaldo: si deja de detectar un cambio, la copia sigue
 * guardándose igual de bien y nadie se entera de nada — el fallo es silencioso
 * por definición.
 *
 * Por eso cada caso comprueba las dos direcciones: que detecta el cambio, y que
 * NO inventa cambios donde no los hay. Un comparador que grita por todo se
 * ignora igual que uno que calla.
 */

const TARIFA: Tarifa = {
  id: 15866,
  name: 'Lista de Precios',
  currency_id: [2, 'USD'],
  company_id: [1, 'Supricom'],
  active: true,
};

const REGLA: ReglaPrecio = {
  id: 42614,
  pricelist_id: [15866, 'Lista de Precios'],
  applied_on: '1_product',
  compute_price: 'fixed',
  fixed_price: 120.5,
  percent_price: false,
  product_tmpl_id: [900, '4534C001AA'],
  categ_id: false,
  min_quantity: 0,
  date_start: false,
  date_end: false,
};

function copia(cambios: Partial<Copia> = {}): Copia {
  return {
    generadoEn: '2026-09-14T00:00:00.000Z',
    tarifas: [structuredClone(TARIFA)],
    reglasDePrecio: [structuredClone(REGLA)],
    clientesPorTarifa: [{ tarifaId: 15866, clientes: 2949 }],
    ...cambios,
  };
}

describe('#48 · Sin cambios', () => {
  it('dos copias iguales no producen ninguna diferencia', () => {
    const d = comparar(copia(), copia());

    expect(d.identicas).toBe(true);
    expect(d.clientesPorTarifa).toEqual([]);
    expect(d.tarifasCambiadas).toEqual([]);
    expect(d.reglasCambiadas).toEqual([]);
    expect(d.reglasNuevas).toBe(0);
    expect(d.reglasDesaparecidas).toBe(0);
  });

  it('un campo que aparece donde antes no estaba SÍ es un cambio', () => {
    /*
     * El caso de comparar contra copias viejas.
     *
     * Si se añade un campo al respaldo, las copias hechas antes no lo tendrán, y
     * al comparar saldrá como cambio en todos los registros. Es ruidoso pero es
     * lo HONESTO: de esa copia no sabemos qué valor tenía, y callarlo sería
     * afirmar que no cambió.
     *
     * Queda escrito aquí para que a nadie le sorprenda el día que amplíe el
     * respaldo y el primer diff contra una copia anterior salga entero en rojo.
     */
    const sinActive = { ...structuredClone(TARIFA) };
    delete (sinActive as { active?: boolean }).active;

    const d = comparar(copia({ tarifas: [sinActive as Tarifa] }), copia());

    expect(d.tarifasCambiadas[0].cambios).toEqual([
      { campo: 'active', antes: null, ahora: true },
    ]);
  });

  it('el orden de los elementos no cuenta como cambio', () => {
    const otraTarifa: Tarifa = { ...TARIFA, id: 15869, name: 'Lista Vendedores' };

    const a = copia({ tarifas: [structuredClone(TARIFA), otraTarifa] });
    const b = copia({ tarifas: [otraTarifa, structuredClone(TARIFA)] });

    // Se compara por id, no por posición. Odoo puede devolver otro orden entre
    // dos consultas y eso no es un cambio de configuración.
    expect(comparar(a, b).identicas).toBe(true);
  });
});

describe('#48 · Clientes que cambian de tarifa', () => {
  it('detecta el movimiento y dice cuántos', () => {
    const d = comparar(
      copia(),
      copia({ clientesPorTarifa: [{ tarifaId: 15866, clientes: 1200 }] }),
    );

    expect(d.identicas).toBe(false);
    expect(d.clientesPorTarifa).toEqual([
      { tarifaId: 15866, nombre: 'Lista de Precios', antes: 2949, ahora: 1200 },
    ]);
  });

  it('detecta una tarifa que se queda SIN clientes', () => {
    /*
     * Este es el que casi se escapa.
     *
     * El script solo apunta las tarifas que tienen algún cliente, así que una
     * que se queda a cero desaparece del recuento en vez de aparecer con 0. Si
     * la comparación recorriera solo la copia nueva, el caso más grave —los
     * 2949 clientes se fueron a otro sitio— no saldría. Por eso se recorre la
     * unión de las dos.
     */
    const d = comparar(copia(), copia({ clientesPorTarifa: [] }));

    expect(d.clientesPorTarifa).toEqual([
      { tarifaId: 15866, nombre: 'Lista de Precios', antes: 2949, ahora: 0 },
    ]);
  });

  it('detecta una tarifa que empieza a tener clientes', () => {
    const d = comparar(
      copia({ clientesPorTarifa: [] }),
      copia({ clientesPorTarifa: [{ tarifaId: 15866, clientes: 40 }] }),
    );

    expect(d.clientesPorTarifa[0]).toMatchObject({ antes: 0, ahora: 40 });
  });

  it('ordena por el tamaño del movimiento, no por id', () => {
    const t2: Tarifa = { ...TARIFA, id: 2, name: 'Otra' };

    const d = comparar(
      copia({
        tarifas: [structuredClone(TARIFA), t2],
        clientesPorTarifa: [
          { tarifaId: 15866, clientes: 2949 },
          { tarifaId: 2, clientes: 10 },
        ],
      }),
      copia({
        tarifas: [structuredClone(TARIFA), t2],
        clientesPorTarifa: [
          { tarifaId: 15866, clientes: 2948 },
          { tarifaId: 2, clientes: 900 },
        ],
      }),
    );

    // El movimiento de 890 va antes que el de 1: quien mira la salida tiene que
    // toparse primero con lo gordo.
    expect(d.clientesPorTarifa[0].tarifaId).toBe(2);
  });
});

describe('#48 · Tarifas', () => {
  it('detecta una tarifa nueva', () => {
    const nueva: Tarifa = { ...TARIFA, id: 99999, name: 'Lista NUEVA' };
    const d = comparar(copia(), copia({ tarifas: [structuredClone(TARIFA), nueva] }));

    expect(d.tarifasNuevas.map((t) => t.id)).toEqual([99999]);
    expect(d.tarifasDesaparecidas).toEqual([]);
  });

  it('detecta una tarifa borrada', () => {
    const d = comparar(copia(), copia({ tarifas: [] }));

    expect(d.tarifasDesaparecidas.map((t) => t.id)).toEqual([15866]);
  });

  it('distingue ARCHIVAR de borrar', () => {
    /*
     * No es lo mismo y no debe salir en el mismo sitio. En Odoo lo normal es
     * archivar; que una tarifa DESAPAREZCA significa que alguien la borró de
     * verdad, y eso casi siempre es un accidente que conviene mirar.
     */
    const d = comparar(copia(), copia({ tarifas: [{ ...structuredClone(TARIFA), active: false }] }));

    expect(d.tarifasDesaparecidas).toEqual([]);
    expect(d.tarifasCambiadas).toHaveLength(1);
    expect(d.tarifasCambiadas[0].cambios).toEqual([
      { campo: 'active', antes: true, ahora: false },
    ]);
  });

  it('detecta un renombrado, con el nombre viejo', () => {
    const d = comparar(
      copia(),
      copia({ tarifas: [{ ...structuredClone(TARIFA), name: 'Lista de Precios 2026' }] }),
    );

    // El nombre viejo importa: sin él no se puede deshacer el cambio a mano.
    expect(d.tarifasCambiadas[0].cambios).toEqual([
      { campo: 'name', antes: 'Lista de Precios', ahora: 'Lista de Precios 2026' },
    ]);
  });

  it('detecta un cambio de moneda', () => {
    const d = comparar(
      copia(),
      copia({ tarifas: [{ ...structuredClone(TARIFA), currency_id: [1, 'VEF'] }] }),
    );

    expect(d.tarifasCambiadas[0].cambios[0].campo).toBe('currency_id');
  });
});

describe('#48 · Reglas de precio', () => {
  it('detecta un precio cambiado y conserva el anterior', () => {
    const d = comparar(
      copia(),
      copia({ reglasDePrecio: [{ ...structuredClone(REGLA), fixed_price: 999.99 }] }),
    );

    expect(d.reglasCambiadas).toHaveLength(1);
    expect(d.reglasCambiadas[0]).toMatchObject({
      id: 42614,
      tarifa: 'Lista de Precios',
      producto: '4534C001AA',
    });
    expect(d.reglasCambiadas[0].cambios).toEqual([
      { campo: 'fixed_price', antes: 120.5, ahora: 999.99 },
    ]);
  });

  it('detecta el cambio de cómo se calcula el precio', () => {
    const d = comparar(
      copia(),
      copia({
        reglasDePrecio: [
          { ...structuredClone(REGLA), compute_price: 'percentage', percent_price: 15 },
        ],
      }),
    );

    // Pasar de precio fijo a porcentaje cambia el precio de todo lo que toca esa
    // regla, aunque `fixed_price` siga igual.
    expect(d.reglasCambiadas[0].cambios.map((c) => c.campo).sort()).toEqual([
      'compute_price',
      'percent_price',
    ]);
  });

  it('cuenta las nuevas y las retiradas sin detallarlas', () => {
    const otra: ReglaPrecio = { ...structuredClone(REGLA), id: 42615 };

    const d = comparar(copia(), copia({ reglasDePrecio: [structuredClone(REGLA), otra] }));
    expect(d.reglasNuevas).toBe(1);
    expect(d.reglasDesaparecidas).toBe(0);

    const inverso = comparar(copia({ reglasDePrecio: [structuredClone(REGLA), otra] }), copia());
    expect(inverso.reglasNuevas).toBe(0);
    expect(inverso.reglasDesaparecidas).toBe(1);
  });

  it('una regla sobre categoría se identifica por la categoría', () => {
    const porCategoria: ReglaPrecio = {
      ...structuredClone(REGLA),
      product_tmpl_id: false,
      categ_id: [7, 'Tóner'],
    };

    const d = comparar(
      copia({ reglasDePrecio: [porCategoria] }),
      copia({ reglasDePrecio: [{ ...porCategoria, fixed_price: 1 }] }),
    );

    // Sin esto la línea saldría como «—» y no habría forma de saber qué regla es.
    expect(d.reglasCambiadas[0].producto).toBe('Tóner');
  });

  it('una regla sobre toda la tarifa se identifica como tal', () => {
    const global: ReglaPrecio = {
      ...structuredClone(REGLA),
      product_tmpl_id: false,
      categ_id: false,
    };

    const d = comparar(
      copia({ reglasDePrecio: [global] }),
      copia({ reglasDePrecio: [{ ...global, fixed_price: 1 }] }),
    );

    expect(d.reglasCambiadas[0].producto).toBe('(toda la tarifa)');
  });
});

describe('#48 · Formato de valores', () => {
  it.each([
    [false, 'no'],
    [true, 'sí'],
    [null, '—'],
    [undefined, '—'],
    [120.5, '120.5'],
    ['fixed', 'fixed'],
  ])('%s → %s', (entrada, esperado) => {
    expect(valor(entrada)).toBe(esperado);
  });

  it('un many2one se muestra por su nombre, no por su id', () => {
    // Llegan como [id, nombre]. Enseñar el array crudo obliga a quien lee la
    // salida a traducir ids de Odoo mentalmente.
    expect(valor([15866, 'Lista de Precios'])).toBe('Lista de Precios');
  });
});
