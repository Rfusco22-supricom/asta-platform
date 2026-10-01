import { describe, expect, it, vi } from 'vitest';
import { LOTE_SONDEO, VigilanteCambios, type Invalidadores, type Lecturas } from '../services/vigilanteCambios.js';

/**
 * #34 · El vigía que invalida la cache por lo que cambia en Odoo.
 *
 * Con un Odoo simulado: los cambios que hay que detectar —una regla nueva, una
 * borrada, un cliente movido de tarifa— no se pueden provocar en el Odoo de
 * producción sin escribir en él. La última prueba sí va contra Odoo real, solo
 * leyendo, para comprobar que los dominios y campos existen en esta versión.
 */

type Fila = Record<string, unknown> & { id: number; write_date: string };

/** Un Odoo de mentira: filas por modelo y recuento de reglas por tarifa. */
function odooFalso() {
  const filas: Record<string, Fila[]> = {
    'product.pricelist.item': [],
    'product.pricelist': [],
    'res.partner': [],
    'product.product': [],
    'product.template': [],
  };
  let recuento: Array<{ pricelist_id: [number, string]; __count: number }> = [];
  let falla: string | null = null;

  const lecturas: Lecturas = {
    searchRead: (async (modelo: string, dominio: unknown[], _campos: string[], opciones: { order?: string; limit?: number } = {}) => {
      if (modelo === falla) throw new Error('Odoo caído');
      // Respeta el operador: con `>` y `>=` iguales, el test del «mismo segundo»
      // no vería la diferencia.
      const filtro = dominio.find((d) => Array.isArray(d) && d[0] === 'write_date') as [string, '>' | '>=', string] | undefined;
      let r = filas[modelo].filter((f) => !filtro || (filtro[1] === '>' ? f.write_date > filtro[2] : f.write_date >= filtro[2]));
      r = [...r].sort((a, b) => a.write_date.localeCompare(b.write_date) || a.id - b.id);
      if (opciones.order?.startsWith('write_date desc')) r.reverse();
      return r.slice(0, opciones.limit ?? r.length);
    }) as Lecturas['searchRead'],
    readGroup: (async () => recuento) as unknown as Lecturas['readGroup'],
  };

  return {
    lecturas,
    añadir: (modelo: string, fila: Fila) => filas[modelo].push(fila),
    reglas: (porTarifa: Record<number, number>) => {
      recuento = Object.entries(porTarifa).map(([id, n]) => ({ pricelist_id: [Number(id), 'x'], __count: n }));
    },
    fallar: (modelo: string | null) => {
      falla = modelo;
    },
  };
}

function invalidadoresEspia() {
  return {
    tarifas: vi.fn(() => 1),
    productos: vi.fn(() => 1),
    clientes: vi.fn(() => 1),
    todo: vi.fn(() => 1),
  } satisfies Invalidadores;
}

const ids = (spy: { mock: { calls: unknown[][] } }, llamada = 0) => [...(spy.mock.calls[llamada][0] as Set<number>)].sort();

async function preparado() {
  const odoo = odooFalso();
  odoo.añadir('product.pricelist.item', { id: 1, write_date: '2026-09-24 10:00:00', pricelist_id: [15836, 'x'] });
  odoo.añadir('res.partner', { id: 500, write_date: '2026-09-24 10:00:00' });
  odoo.reglas({ 15836: 10, 15863: 20 });
  const inv = invalidadoresEspia();
  const v = new VigilanteCambios(odoo.lecturas, inv);
  await v.iniciar();
  return { odoo, inv, v };
}

describe('#34 · Qué se invalida', () => {
  it('sin cambios desde el arranque no se invalida nada', async () => {
    // Lo anterior al arranque no se procesa: la cache arranca vacía.
    const { inv, v } = await preparado();
    const r = await v.vuelta();
    expect(r.cambios).toEqual({});
    expect(r.entradasInvalidadas).toBe(0);
    for (const f of Object.values(inv)) expect(f).not.toHaveBeenCalled();
  });

  it('una regla cambiada invalida SU tarifa, no las demás', async () => {
    const { odoo, inv, v } = await preparado();
    odoo.añadir('product.pricelist.item', { id: 2, write_date: '2026-09-24 10:05:00', pricelist_id: [15863, 'x'] });
    await v.vuelta();
    expect(ids(inv.tarifas)).toEqual([15863]);
  });

  it('una regla BORRADA, que no deja write_date, se ve en el recuento', async () => {
    const { odoo, inv, v } = await preparado();
    odoo.reglas({ 15836: 9, 15863: 20 });
    const r = await v.vuelta();
    expect(r.tarifasRecontadas).toEqual([15836]);
    expect(ids(inv.tarifas)).toEqual([15836]);
  });

  it('la última regla de una tarifa borrada también: la tarifa desaparece del recuento', async () => {
    const { odoo, inv, v } = await preparado();
    odoo.reglas({ 15863: 20 });
    await v.vuelta();
    expect(ids(inv.tarifas)).toEqual([15836]);
  });

  it('un cliente cambiado invalida su tarifa y su almacén', async () => {
    const { odoo, inv, v } = await preparado();
    odoo.añadir('res.partner', { id: 777, write_date: '2026-09-24 11:00:00' });
    await v.vuelta();
    expect(ids(inv.clientes)).toEqual([777]);
  });

  it('una plantilla cambiada invalida los precios de sus variantes', async () => {
    // `sale_ok` vive en la plantilla: cambiarlo no toca el write_date de la variante.
    const { odoo, inv, v } = await preparado();
    odoo.añadir('product.template', { id: 30, write_date: '2026-09-24 11:00:00', product_variant_ids: [301, 302] });
    await v.vuelta();
    expect(ids(inv.productos)).toEqual([301, 302]);
  });

  it(`más de ${LOTE_SONDEO} cambios de golpe vacía la categoría entera`, async () => {
    // Una importación: no se sabe qué quedó fuera del lote.
    const { odoo, inv, v } = await preparado();
    for (let i = 0; i < LOTE_SONDEO + 5; i++) {
      odoo.añadir('product.product', { id: 1000 + i, write_date: '2026-09-24 12:00:00' });
    }
    await v.vuelta();
    expect(inv.todo).toHaveBeenCalledWith('productos');
    expect(inv.productos).not.toHaveBeenCalled();
  });
});

describe('#34 · La marca de agua', () => {
  it('lo ya procesado no se reprocesa, aunque se relea el mismo segundo', async () => {
    const { odoo, inv, v } = await preparado();
    odoo.añadir('res.partner', { id: 777, write_date: '2026-09-24 11:00:00' });
    await v.vuelta();
    await v.vuelta();
    expect(inv.clientes).toHaveBeenCalledTimes(1);
  });

  it('un cambio nuevo en el MISMO segundo que el último sí se procesa', async () => {
    // `write_date` va por segundos: con `>` a secas se perdería.
    const { odoo, inv, v } = await preparado();
    odoo.añadir('res.partner', { id: 777, write_date: '2026-09-24 11:00:00' });
    await v.vuelta();
    odoo.añadir('res.partner', { id: 778, write_date: '2026-09-24 11:00:00' });
    await v.vuelta();
    expect(ids(inv.clientes, 1)).toEqual([778]);
  });

  it('si Odoo falla, la marca no se mueve y la vuelta siguiente lo recoge', async () => {
    const { odoo, inv, v } = await preparado();
    odoo.añadir('res.partner', { id: 777, write_date: '2026-09-24 11:00:00' });
    odoo.fallar('res.partner');
    const r = await v.vuelta();
    expect(r.fallidos).toEqual(['res.partner']);
    expect(inv.clientes).not.toHaveBeenCalled();

    odoo.fallar(null);
    await v.vuelta();
    expect(ids(inv.clientes)).toEqual([777]);
  });

  it('dos vueltas a la vez son la misma vuelta', async () => {
    const { v } = await preparado();
    expect(v.vuelta()).toBe(v.vuelta());
  });
});

describe('#34 · Contra Odoo real (solo lectura)', () => {
  it('arranca y da una vuelta sin fallos: los dominios y campos existen en Odoo 17', async () => {
    const inv = invalidadoresEspia();
    const v = new VigilanteCambios(undefined, inv);
    await v.iniciar();
    const r = await v.vuelta();
    expect(r.fallidos).toEqual([]);
  });
});
