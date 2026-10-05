import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARCA_ASTA } from '../services/asta.service.js';
import { NO_SON_VENTA, agregarReporte, reporteProductos, vaciarCacheReporteProductos, type FichaProducto, type GrupoLinea } from '../services/reporteProductos.service.js';
import { idsDeCartera } from '../services/partners.service.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { TIPO_FACTURADO_LINEA } from '../services/criterioFacturacion.js';
import { LINEA_ASTA } from '../services/ventasAsta.service.js';

/**
 * Reporte de clientes por producto.
 *
 * La suma se prueba con datos hechos a mano. El alcance, contra la instancia:
 * el filtro es `partner_id.user_id` y no la lista de la cartera (14,7 s frente a
 * 1,3 s), así que hay que fijar que es EL MISMO conjunto. Si un día no lo es, el
 * vendedor vería clientes de otro, o le faltarían suyos.
 */

const linea = (producto: [number, string], cliente: [number, string], balance: number, quantity: number, move_type = 'out_invoice'): GrupoLinea => ({
  product_id: producto,
  partner_id: cliente,
  move_type,
  balance,
  quantity,
});

const TONER_ASTA: [number, string] = [10, '[AST-278] ASTA TONER CE278A'];
const TONER_HP: [number, string] = [11, '[CE278A] HP TONER 78A'];
const MOUSE: [number, string] = [12, 'MOUSE LOGITECH M90'];
const PAPELERIA: [number, string] = [1, 'X'];
const ANA: [number, string] = [500, 'ANA C.A. '];
const BETO: [number, string] = [501, 'BETO S.R.L.'];

const fichas: FichaProducto[] = [
  { id: 10, categ_id: [7, 'CONSUMIBLES'], spiff_brand_id: [MARCA_ASTA, 'ASTA'] },
  { id: 11, categ_id: [7, 'CONSUMIBLES'], spiff_brand_id: [3, 'HP'] },
  { id: 12, categ_id: [8, 'PEREFERICOS DE COMPUTACION'], spiff_brand_id: [4, 'LOGITECH'] },
];

describe('agregación del reporte', () => {
  const r = agregarReporte(
    [
      linea(TONER_ASTA, ANA, -300, 3),
      linea(TONER_ASTA, ANA, 100, 1, 'out_refund'), // devuelve uno
      linea(TONER_HP, ANA, -500, 2),
      linea(TONER_HP, BETO, -250, 1),
      linea(MOUSE, BETO, -40, 4),
      { ...linea(PAPELERIA, BETO, -999, 1), product_id: false }, // concepto a mano: fuera
      linea([99, '[SAL_INI] Saldo Inicial'], ANA, -5000, -1), // saldo de apertura: apartado
      linea([99, '[SAL_INI] Saldo Inicial'], BETO, -2000, -1),
    ],
    fichas,
    new Set([7]), // ASTA compite en consumibles, no en periféricos
  );

  it('totales sin impuestos, con las notas de crédito restando', () => {
    expect(r.totales).toEqual({ monto: 990, montoAsta: 200, montoEnCompetencia: 950, clientes: 2, productos: 3 });
  });

  it('el saldo inicial no es una venta: se aparta y se dice cuánto', () => {
    expect(r.apartados).toEqual([{ sku: 'SAL_INI', nombre: 'Saldo Inicial', monto: 7000, clientes: 2 }]);
    expect(r.categorias.flatMap((c) => c.productos).some((p) => p.sku === 'SAL_INI')).toBe(false);
  });

  it('quien solo tiene una nota de crédito sale en la lista pero no cuenta como comprador', () => {
    const r2 = agregarReporte(
      [linea(TONER_ASTA, ANA, -300, 3), linea(TONER_ASTA, BETO, 63, 1, 'out_refund')],
      fichas,
    );
    expect(r2.totales.clientes).toBe(1);
    expect(r2.clientes.map((c) => [c.nombre, c.monto])).toEqual([
      ['ANA C.A.', 300],
      ['BETO S.R.L.', -63],
    ]);
  });

  it('las cantidades también restan con la devolución', () => {
    const asta = r.categorias.find((c) => c.categoriaId === 7)!.productos.find((p) => p.productId === 10)!;
    expect(asta).toMatchObject({ sku: 'AST-278', nombre: 'ASTA TONER CE278A', marca: 'ASTA', esAsta: true, cantidad: 2, monto: 200 });
  });

  it('categorías de más a menos, con su parte ASTA y sus clientes distintos', () => {
    expect(r.categorias.map((c) => [c.nombre, c.monto, c.montoAsta, c.enCompetencia, c.clientes])).toEqual([
      ['CONSUMIBLES', 950, 200, true, 2],
      ['PEREFERICOS DE COMPUTACION', 40, 0, false, 1],
    ]);
    // Dentro, los productos también de más a menos: el HP (750) antes que el ASTA (200).
    expect(r.categorias[0]!.productos.map((p) => p.productId)).toEqual([11, 10]);
  });

  it('cada producto dice quién lo compra, de más a menos', () => {
    const hp = r.categorias[0]!.productos[0]!;
    expect(hp.clientes).toEqual([
      { partnerId: 500, nombre: 'ANA C.A.', cantidad: 2, monto: 500 },
      { partnerId: 501, nombre: 'BETO S.R.L.', cantidad: 1, monto: 250 },
    ]);
  });

  it('por cliente: cuánto, cuánto es ASTA y en qué categorías', () => {
    expect(r.clientes).toEqual([
      {
        partnerId: 500,
        nombre: 'ANA C.A.',
        monto: 700,
        montoAsta: 200,
        montoEnCompetencia: 700,
        productosDistintos: 2,
        categorias: [{ categoriaId: 7, nombre: 'CONSUMIBLES', monto: 700 }],
      },
      {
        partnerId: 501,
        nombre: 'BETO S.R.L.',
        monto: 290,
        montoAsta: 0,
        // El ratón (periféricos) no cuenta: ahí ASTA no fabrica.
        montoEnCompetencia: 250,
        productosDistintos: 2,
        categorias: [
          { categoriaId: 7, nombre: 'CONSUMIBLES', monto: 250 },
          { categoriaId: 8, nombre: 'PEREFERICOS DE COMPUTACION', monto: 40 },
        ],
      },
    ]);
  });

  it('sin líneas, todo a cero', () => {
    expect(agregarReporte([], [])).toEqual({ totales: { monto: 0, montoAsta: 0, montoEnCompetencia: 0, clientes: 0, productos: 0 }, categorias: [], clientes: [], apartados: [] });
  });
});

/** Dos vendedores reales con cartera pequeña, para que el test no espere. */
let A = 0;
let B = 0;
const RANGO = { desde: '2026-04-01', hasta: '2026-09-30' };

beforeAll(async () => {
  vaciarCacheReporteProductos();
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
  const conCartera = [...cuenta.entries()].filter(([, n]) => n >= 10).sort((a, b) => a[1] - b[1]).map(([uid]) => uid);
  if (conCartera.length < 2) throw new Error('Hacen falta dos vendedores con cartera.');
  [A, B] = conCartera;
});

afterAll(() => vaciarCacheReporteProductos());

describe('reporte por producto · cada vendedor ve solo su cartera', () => {
  it('ningún cliente del reporte está fuera de su cartera', async () => {
    const [r, ids] = await Promise.all([reporteProductos(A, RANGO), idsDeCartera(A)]);
    const deLaCartera = new Set(ids);
    expect(r.clientes.filter((c) => !deLaCartera.has(c.partnerId)).map((c) => c.nombre)).toEqual([]);
  });

  it('el filtro por comercial suma lo mismo que la lista de la cartera', async () => {
    const [r, ids] = await Promise.all([reporteProductos(A, RANGO), idsDeCartera(A)]);
    const grupos = await readGroup<{ balance: number; product_id: [number, string] | false }>(
      'account.move.line',
      [
        ['display_type', '=', 'product'],
        ['parent_state', '=', 'posted'],
        TIPO_FACTURADO_LINEA,
        ['invoice_date', '>=', RANGO.desde],
        ['invoice_date', '<=', RANGO.hasta],
        ['partner_id', 'in', ids],
        ['product_id', '!=', false],
        ['product_id.default_code', 'not in', [...NO_SON_VENTA]],
        // Solo ASTA, como el reporte (ver `ventasAsta.service`).
        LINEA_ASTA,
      ],
      ['balance:sum'],
      ['product_id'],
    );
    const conLista = Math.round(-grupos.reduce((s, g) => s + g.balance, 0) * 100) / 100;
    expect(r.totales.monto).toBeCloseTo(conLista, 1);
  });

  /*
   * El que se escapó en la revisión de #178: al recorrer `partner_id.user_id`,
   * Odoo 17 NO aplica `active_test`, y los clientes archivados del vendedor
   * entraban en el reporte aunque no estén en su cartera. Se busca uno de
   * verdad —archivado, con vendedor y con ventas— y se comprueba que no sale.
   */
  it('un cliente archivado no sale, aunque siga asignado al vendedor y tenga ventas', async (ctx) => {
    const archivados = await readGroup<{ partner_id: [number, string] | false; 'partner_id.user_id'?: unknown }>(
      'account.move.line',
      [
        ['display_type', '=', 'product'],
        ['parent_state', '=', 'posted'],
        TIPO_FACTURADO_LINEA,
        ['invoice_date', '>=', '2025-01-01'],
        ['partner_id.parent_id', '=', false],
        ['partner_id.user_id', '!=', false],
        ['partner_id.active', '=', false],
      ],
      ['balance:sum'],
      ['partner_id'],
    );
    const [grupo] = archivados.filter((g) => g.partner_id);
    if (!grupo || !grupo.partner_id) return ctx.skip();
    const partnerId = grupo.partner_id[0];

    const [ficha] = await searchRead<{ user_id: [number, string] | false }>(
      'res.partner',
      [['id', '=', partnerId], ['active', '=', false]],
      ['user_id'],
    );
    expect(ficha?.user_id, 'el archivado tiene vendedor').toBeTruthy();
    const vendedor = (ficha!.user_id as [number, string])[0];

    const r = await reporteProductos(vendedor, { desde: '2025-01-01', hasta: '2026-12-31' });
    expect(r.clientes.map((c) => c.partnerId)).not.toContain(partnerId);
    expect(r.categorias.flatMap((c) => c.productos.flatMap((p) => p.clientes.map((x) => x.partnerId)))).not.toContain(partnerId);
  });

  it('A y B no comparten ningún cliente', async () => {
    const [ra, rb] = await Promise.all([reporteProductos(A, RANGO), reporteProductos(B, RANGO)]);
    const deA = new Set(ra.clientes.map((c) => c.partnerId));
    expect(rb.clientes.filter((c) => deA.has(c.partnerId)).map((c) => c.nombre)).toEqual([]);
  });

  it('la segunda vez sale de la caché, que es por vendedor y periodo', async () => {
    const primera = await reporteProductos(A, RANGO);
    const segunda = await reporteProductos(A, RANGO);
    expect(segunda.meta.desdeCache).toBe(true);
    expect(segunda.totales).toEqual(primera.totales);
    const otroPeriodo = await reporteProductos(A, { desde: '2026-01-01', hasta: '2026-03-31' });
    expect(otroPeriodo.meta.desdeCache).toBe(false);
  });
});
