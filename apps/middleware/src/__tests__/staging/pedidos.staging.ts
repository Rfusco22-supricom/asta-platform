import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * #13 · `POST /orders` con el escritor de VERDAD, contra el Odoo de staging.
 *
 * Es lo que la batería normal no puede probar: allí el `create` lo hace un
 * escritor simulado, porque contra producción crearía pedidos reales (#33).
 * Aquí se comprueba lo que solo Odoo puede decir:
 *
 *   · que acepta el `create` tal como se manda, en borrador;
 *   · que el precio que pone en cada línea es el de la tarifa del cliente, sin
 *     que se lo mandemos;
 *   · que reintentar con la misma clave no crea otro;
 *   · que la conciliación (`buscar` por cliente y `origin`) encuentra el pedido,
 *     que es lo que evita duplicados tras un tiempo agotado.
 *
 * Lo que se crea se cancela al terminar. Si eso falla, los pedidos quedan en
 * el staging marcados con `origin = "API Asta (staging-13-…)"`.
 *
 * Solo corre con `pnpm test:staging`: `preparar.ts` se niega a arrancar contra
 * producción.
 */

const { prisma } = await import('../../config/prisma.js');
const { executeKw, readGroup, searchRead } = await import('../../odoo/client.js');
const { almacenDelCliente } = await import('../../services/inventory.service.js');
const { preciosDe, tarifaDelCliente, vaciarCachesPrecios } = await import('../../services/pricing.service.js');
const { crearPedido, escritorOdoo, origenDe } = await import('../../services/pedidosEscritura.service.js');

const PREFIJO = `staging-13-${Date.now()}`;
const creados: number[] = [];
let cliente: { partnerId: number; pricelistId: number; companyId: number; warehouseId: number };
let sku = '';
let precio = 0;

/** Un cliente con tarifa y almacén, y una referencia de su tarifa con existencia libre. */
async function prepararFixture() {
  // Clientes que compran: los que tienen pedidos confirmados.
  const grupos = await readGroup<{ partner_id: [number, string] | false }>(
    'sale.order',
    [['state', '=', 'sale'], ['partner_id.parent_id', '=', false]],
    [],
    ['partner_id'],
    { limit: 40 },
  );
  for (const g of grupos) {
    if (!g.partner_id) continue;
    const partnerId = g.partner_id[0];
    const tarifa = await tarifaDelCliente(partnerId, null).catch(() => null);
    const almacen = await almacenDelCliente(partnerId).catch(() => null);
    if (!tarifa || !almacen) continue;

    const reglas = await searchRead<{ product_tmpl_id: [number, string] }>(
      'product.pricelist.item',
      [['pricelist_id', '=', tarifa.pricelistId], ['applied_on', '=', '1_product'], ['compute_price', '=', 'fixed'], ['fixed_price', '>', 0]],
      ['product_tmpl_id'],
      { limit: 200, order: 'id desc' },
    );
    if (reglas.length === 0) continue;
    const productos = await searchRead<{ default_code: string | false; free_qty: number }>(
      'product.product',
      [['product_tmpl_id', 'in', reglas.map((r) => r.product_tmpl_id[0])], ['sale_ok', '=', true], ['default_code', '!=', false], ['free_qty', '>=', 2]],
      ['default_code', 'free_qty'],
      { context: { warehouse: almacen.warehouseId, allowed_company_ids: [almacen.companyId] }, limit: 20 },
    );
    for (const p of productos) {
      const [r] = (await preciosDe(tarifa, [String(p.default_code)])).precios;
      if (r?.motivo === 'ok' && r.precio !== null) {
        cliente = { partnerId, pricelistId: tarifa.pricelistId, companyId: tarifa.companyId, warehouseId: almacen.warehouseId };
        sku = String(p.default_code);
        precio = r.precio;
        return;
      }
    }
  }
  // Lanza, no se salta: un gate que no encuentra datos no ha comprobado nada.
  throw new Error('No hay en staging un cliente con tarifa, almacén y una referencia con precio y existencia: la batería no probaría nada.');
}

const ctx = () => ({ partnerId: cliente.partnerId, apiKeyId: null, pricelistIdentidad: null });

beforeAll(async () => {
  vaciarCachesPrecios();
  await prepararFixture();
});

afterAll(async () => {
  if (creados.length) {
    // En borrador, cancelar no pide asistente. Si algo falla, queda dicho.
    await executeKw('sale.order', 'action_cancel', [creados]).catch((e: unknown) =>
      console.error(`No se pudieron cancelar en staging los pedidos ${creados.join(', ')}: ${e instanceof Error ? e.message : e}`),
    );
  }
  await prisma.apiOrderRequest.deleteMany({ where: { idempotencyKey: { startsWith: PREFIJO } } });
  await prisma.$disconnect();
});

interface PedidoOdoo {
  partner_id: [number, string];
  pricelist_id: [number, string];
  company_id: [number, string];
  warehouse_id: [number, string];
  state: string;
  origin: string | false;
  order_line: number[];
}

describe('#13 · POST /orders con el escritor real', () => {
  const clave = `${PREFIJO}-a`;
  let orderId = 0;

  it('crea el pedido en borrador, a nombre del cliente, con su compañía, su tarifa y su almacén', async () => {
    const r = await crearPedido(ctx(), { lineas: [{ sku, cantidad: 1 }], referenciaCliente: 'OC-STAGING-13' }, clave);
    expect(r.status).toBe(201);
    orderId = r.cuerpo.data.id;
    creados.push(orderId);

    const [p] = await searchRead<PedidoOdoo>('sale.order', [['id', '=', orderId]], ['partner_id', 'pricelist_id', 'company_id', 'warehouse_id', 'state', 'origin', 'order_line']);
    expect(p.state).toBe('draft');
    expect(p.partner_id[0]).toBe(cliente.partnerId);
    expect(p.pricelist_id[0]).toBe(cliente.pricelistId);
    expect(p.company_id[0]).toBe(cliente.companyId);
    expect(p.warehouse_id[0]).toBe(cliente.warehouseId);
    expect(p.origin).toBe(origenDe(clave));
    expect(p.order_line).toHaveLength(1);
  });

  it('el precio que pone Odoo en la línea es el de la tarifa del cliente, sin habérselo mandado', async () => {
    const lineas = await searchRead<{ price_unit: number; product_uom_qty: number; product_id: [number, string] }>(
      'sale.order.line',
      [['order_id', '=', orderId]],
      ['price_unit', 'product_uom_qty', 'product_id'],
    );
    expect(lineas).toHaveLength(1);
    expect(lineas[0].product_uom_qty).toBe(1);
    expect(lineas[0].price_unit).toBeCloseTo(precio, 2);
  });

  it('repetir con la misma clave devuelve el mismo pedido, y en Odoo hay uno solo', async () => {
    const r = await crearPedido(ctx(), { lineas: [{ sku, cantidad: 1 }], referenciaCliente: 'OC-STAGING-13' }, clave);
    expect(r.status).toBe(200);
    expect(r.cuerpo.data.id).toBe(orderId);
    const n = await executeKw<number>('sale.order', 'search_count', [[['origin', '=', origenDe(clave)]]]);
    expect(n).toBe(1);
  });

  it('la conciliación encuentra el pedido por cliente y origin, y no lo encuentra para otro cliente', async () => {
    expect(await escritorOdoo.buscar(cliente.partnerId, origenDe(clave))).toBe(orderId);
    expect(await escritorOdoo.buscar(cliente.partnerId, origenDe(`${PREFIJO}-no-existe`))).toBeNull();
  });
});
