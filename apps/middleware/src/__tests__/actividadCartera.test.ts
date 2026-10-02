import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actividadDeCartera, clasificarCartera, vaciarCacheActividad } from '../services/actividadCartera.service.js';
import { idsDeCartera } from '../services/partners.service.js';
import { mesesDe } from '../services/reportes.service.js';
import { searchRead } from '../odoo/client.js';

/**
 * «Mi cartera»: estado, clase ABC y tendencia de cada cliente.
 *
 * La clasificación se prueba con datos hechos a mano, sin Odoo: cada caso es
 * una frontera que la pantalla pinta de un color. El aislamiento se prueba
 * contra la instancia, como el de ASTA: sin RLS detrás, un dominio mal escrito
 * enseñaría la cartera de otro y nada lo pararía.
 */

const HOY = '2026-10-02';
const MESES = mesesDe({ desde: '2025-11-01', hasta: HOY });

function caso(fechas: Record<number, [primera: string, ultima: string]>, porMes: Record<number, Record<string, number>> = {}) {
  const ids = [...new Set([...Object.keys(fechas), ...Object.keys(porMes)].map(Number))];
  return clasificarCartera({
    ids,
    fechas: new Map(Object.entries(fechas).map(([id, [primera, ultima]]) => [Number(id), { primera, ultima }])),
    porMes: new Map(Object.entries(porMes).map(([id, m]) => [Number(id), new Map(Object.entries(m))])),
    meses: MESES,
    hoy: HOY,
  });
}

const de = (filas: ReturnType<typeof caso>, id: number) => filas.find((f) => f.partnerId === id)!;

describe('clasificación de la cartera', () => {
  it('doce meses, del más antiguo al actual', () => {
    expect(MESES).toHaveLength(12);
    expect(MESES[0]).toBe('2025-11');
    expect(MESES.at(-1)).toBe('2026-10');
  });

  it('sin una sola factura es prospecto, sin clase ni tendencia', () => {
    const [p] = clasificarCartera({ ids: [1], fechas: new Map(), porMes: new Map(), meses: MESES, hoy: HOY });
    expect(p).toMatchObject({ estado: 'prospecto', diasSinComprar: null, clase: null, tendencia: null, facturado12m: 0 });
    expect(p!.serie).toEqual(Array(12).fill(0));
  });

  it('el estado sale de los días sin comprar, con los umbrales de la ficha (60 y 120)', () => {
    const f = caso({
      1: ['2024-01-10', '2026-09-20'], // 12 días
      2: ['2024-01-10', '2026-08-03'], // 60: justo en riesgo
      3: ['2024-01-10', '2026-06-04'], // 120: justo dormido
      4: ['2024-01-10', '2026-06-05'], // 119: todavía en riesgo
    });
    expect(de(f, 1)).toMatchObject({ estado: 'activo', diasSinComprar: 12 });
    expect(de(f, 2)).toMatchObject({ estado: 'en_riesgo', diasSinComprar: 60 });
    expect(de(f, 3)).toMatchObject({ estado: 'dormido', diasSinComprar: 120 });
    expect(de(f, 4)).toMatchObject({ estado: 'en_riesgo', diasSinComprar: 119 });
  });

  it('nuevo es quien empezó hace menos de 90 días y sigue comprando', () => {
    const f = caso({
      1: ['2026-08-15', '2026-09-30'], // empezó hace 48 días
      2: ['2026-07-04', '2026-07-04'], // 90 días: ya no es nuevo, y está en riesgo
      3: ['2026-07-20', '2026-07-20'], // 74 días desde su única compra: en riesgo, no nuevo
    });
    expect(de(f, 1).estado).toBe('nuevo');
    expect(de(f, 2).estado).toBe('en_riesgo');
    expect(de(f, 3).estado).toBe('en_riesgo');
  });

  it('ABC: el que cruza el 80 % todavía es A; a partir del 95 %, C', () => {
    const f = caso(
      {},
      {
        1: { '2026-09': 1000 },
        2: { '2026-09': 500 },
        3: { '2026-09': 300 }, // antes de él, 75 %: A
        4: { '2026-09': 100 }, // 90 %: B
        5: { '2026-09': 50 }, // 95 %: C
        6: { '2026-09': 50 },
        7: { '2026-09': 0 },
      },
    );
    expect([1, 2, 3, 4, 5, 6, 7].map((id) => de(f, id).clase)).toEqual(['A', 'A', 'A', 'B', 'C', 'C', null]);
  });

  it('las devoluciones restan, y quien queda en negativo no tiene clase', () => {
    const f = caso({}, { 1: { '2026-08': 300, '2026-09': -400 }, 2: { '2026-09': 100 } });
    expect(de(f, 1)).toMatchObject({ facturado12m: -100, clase: null });
    expect(de(f, 2).clase).toBe('A');
  });

  it('tendencia: tres meses completos frente a los tres anteriores; el mes en curso no cuenta', () => {
    const f = caso(
      {},
      {
        1: { '2026-04': 100, '2026-05': 100, '2026-06': 100, '2026-07': 150, '2026-08': 150, '2026-09': 150, '2026-10': 9999 },
        2: { '2026-07': 500 }, // nada en los tres anteriores: sin base
        3: { '2026-04': 200, '2026-05': 100 }, // ha dejado de comprar
      },
    );
    expect(de(f, 1).tendencia).toBe(50);
    expect(de(f, 2).tendencia).toBeNull();
    expect(de(f, 3).tendencia).toBe(-100);
  });
});

/** Dos vendedores reales con cartera, descubiertos de la instancia. */
let A = 0;
let B = 0;

beforeAll(async () => {
  vaciarCacheActividad();
  const partners = await searchRead<{ user_id: [number, string] | false }>(
    'res.partner',
    [
      ['customer_rank', '>', 0],
      ['user_id', '!=', false],
      ['parent_id', '=', false],
      ['active', '=', true],
    ],
    ['user_id'],
  );
  const cuenta = new Map<number, number>();
  for (const p of partners) if (p.user_id) cuenta.set(p.user_id[0], (cuenta.get(p.user_id[0]) ?? 0) + 1);
  // Los dos con cartera más PEQUEÑA de entre los que tienen al menos diez
  // clientes: el aislamiento es el mismo y el test no espera 5 s.
  const conCartera = [...cuenta.entries()].filter(([, n]) => n >= 10).sort((a, b) => a[1] - b[1]).map(([uid]) => uid);
  if (conCartera.length < 2) throw new Error('Hacen falta dos vendedores con cartera.');
  [A, B] = conCartera;
});

afterAll(() => vaciarCacheActividad());

describe('actividad de la cartera · cada vendedor ve solo la suya', () => {
  it('son exactamente los clientes de su cartera, ni uno más', async () => {
    const [r, ids] = await Promise.all([actividadDeCartera(A), idsDeCartera(A)]);
    expect(r.data.map((f) => f.partnerId).sort((x, y) => x - y)).toEqual([...ids].sort((x, y) => x - y));
    expect(r.meta.meses).toHaveLength(12);
    expect(r.data.every((f) => f.serie.length === 12)).toBe(true);
  });

  it('A y B no comparten ningún cliente', async () => {
    const [ra, rb] = await Promise.all([actividadDeCartera(A), actividadDeCartera(B)]);
    const deA = new Set(ra.data.map((f) => f.partnerId));
    expect(rb.data.filter((f) => deA.has(f.partnerId)).map((f) => f.partnerId)).toEqual([]);
  });

  it('la segunda vez sale de la caché, y la caché es por vendedor', async () => {
    const primera = await actividadDeCartera(A);
    const segunda = await actividadDeCartera(A);
    expect(segunda.meta.desdeCache).toBe(true);
    expect(segunda.data).toEqual(primera.data);
    const deB = await actividadDeCartera(B);
    expect(deB.data).not.toEqual(segunda.data);
  });
});
