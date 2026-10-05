import { beforeAll, describe, expect, it } from 'vitest';
import { searchRead } from '../odoo/client.js';
import { reporteAstaDeLaEmpresa, reporteAstaDelVendedor } from '../services/reporteAsta.service.js';
import {
  clientesDelRif,
  compras,
  elegirCliente,
  indexarPorRif,
  normalizarNombre,
  normalizarRif,
  smartbit,
  ventasDeClientes,
  type ClienteConRif,
  type Smartbit,
  type VentaSmartbit,
} from '../services/smartbit.service.js';
import { resumenAstaDeCliente, totalesAstaDeCartera } from '../services/ventasAsta.service.js';

/**
 * Las ventas ASTA de Smartbit, lo de antes de Odoo (`smartbit.service`).
 *
 * Primero las reglas con datos hechos a mano. Después, contra la tabla local y
 * Odoo (solo lectura): en un periodo de 2023, cuando ASTA aún no estaba en
 * Odoo, lo que dicen los reportes, la ficha y la cartera tiene que ser lo que
 * dice la tabla. Si la tabla local está vacía, esa parte no comprueba nada.
 */

const venta = (v: Partial<VentaSmartbit>): VentaSmartbit => ({
  fecha: '2025-01-10',
  vendedorId: 1,
  vendedor: 'Ana',
  rif: 'J1',
  partnerId: 10,
  cliente: 'Cliente',
  productId: 5,
  sku: 'A-1',
  articulo: 'Tóner',
  venta: 10,
  unidades: 1,
  ...v,
});

const cliente = (id: number, vat: string, extra: Partial<ClienteConRif> = {}): ClienteConRif => ({ id, vat, active: true, user_id: false, ...extra });

describe('smartbit · normalizar', () => {
  it('el RIF, sin guiones, puntos ni la C de delante', () => {
    expect(normalizarRif('J-41285173-0')).toBe('J412851730');
    expect(normalizarRif(' j.41285173.0 ')).toBe('J412851730');
    expect(normalizarRif('CJ412851730')).toBe('J412851730');
    expect(normalizarRif('')).toBeNull();
    expect(normalizarRif(null)).toBeNull();
  });

  it('el nombre, sin acentos, signos ni espacios de más', () => {
    expect(normalizarNombre('EMILI BRICEÑO.')).toBe(normalizarNombre('Emili  Briceno'));
    expect(normalizarNombre('DANIELA  SUAREZ')).toBe('DANIELA SUAREZ');
  });
});

describe('smartbit · casar el RIF con Odoo', () => {
  it('por dígitos solo si no hay duda: V y J con los mismos números son dos personas', () => {
    const indice = indexarPorRif([cliente(1, 'J12345678'), cliente(2, 'V12345678'), cliente(3, 'J87654321')]);
    expect(clientesDelRif('12345678', indice)).toEqual([]);
    expect(clientesDelRif('87654321', indice).map((c) => c.id)).toEqual([3]);
    expect(clientesDelRif('J12345678', indice).map((c) => c.id)).toEqual([1]);
  });

  it('entre duplicados, el activo, con vendedor, y el más antiguo', () => {
    expect(elegirCliente([cliente(5, 'J1'), cliente(3, 'J1', { active: false }), cliente(9, 'J1', { user_id: [7, 'Ana'] })])).toBe(9);
    expect(elegirCliente([cliente(5, 'J1'), cliente(4, 'J1')])).toBe(4);
    expect(elegirCliente([])).toBeNull();
  });

  it('la historia de un RIF va a UN cliente de la lista, aunque tenga duplicados', () => {
    const sb: Smartbit = { ventas: [venta({ rif: 'J1' }), venta({ rif: 'J1', fecha: '2025-02-01' })], indice: indexarPorRif([cliente(4, 'J1'), cliente(8, 'J-1')]) };
    const r = ventasDeClientes(sb, [8, 4]);
    expect([...r.keys()]).toEqual([4]);
    expect(r.get(4)).toHaveLength(2);
    // Si la lista solo tiene el otro duplicado, es suya.
    expect([...ventasDeClientes(sb, [8]).keys()]).toEqual([8]);
    expect(ventasDeClientes(sb, [99]).size).toBe(0);
  });
});

describe('smartbit · compras', () => {
  it('un cliente en un día con un vendedor es una compra; un día de solo devoluciones, no', () => {
    const c = compras([
      venta({}),
      venta({ venta: 5 }),
      venta({ vendedor: 'Luis', vendedorId: 2 }),
      venta({ fecha: '2025-01-11', venta: -10 }),
      venta({ rif: 'J2' }),
    ]);
    expect(c).toHaveLength(3);
  });
});

// ── Contra la tabla local y Odoo ─────────────────────────────────────────────

const RANGO = { desde: '2023-01-01', hasta: '2023-12-31' };
let sb: Smartbit = { ventas: [], indice: { porRif: new Map(), porDigitos: new Map() } };
let delRango: VentaSmartbit[] = [];
const suma = (vs: VentaSmartbit[]) => vs.reduce((s, v) => s + v.venta, 0);

beforeAll(async () => {
  sb = await smartbit();
  delRango = sb.ventas.filter((v) => v.fecha >= RANGO.desde && v.fecha <= RANGO.hasta);
}, 120_000);

describe('smartbit · los reportes cuentan lo que dice la tabla', () => {
  it('la empresa: lo facturado es la tabla, y «por vendedor» lo reparte entero', async () => {
    if (delRango.length === 0) return;
    const r = await reporteAstaDeLaEmpresa(RANGO);
    expect(r.totales.facturado).toBeCloseTo(suma(delRango), 0);
    expect(r.totales.facturas).toBe(compras(delRango).length);
    expect(r.serieMensual.reduce((s, p) => s + p.monto, 0)).toBeCloseTo(suma(delRango), 0);
    const filas = r.porVendedor ?? [];
    expect(filas.reduce((s, f) => s + f.facturado, 0)).toBeCloseTo(r.totales.facturado, 0);
    expect(filas.reduce((s, f) => s + f.facturas, 0)).toBe(r.totales.facturas);
    // Smartbit no trae saldos.
    expect(r.totales.porCobrar).toBe(0);
  }, 120_000);

  it('el vendedor: las ventas que hizo él, y su fila en la empresa es su reporte', async () => {
    const vendedores = new Map<number, number>();
    for (const v of delRango) if (v.vendedorId) vendedores.set(v.vendedorId, (vendedores.get(v.vendedorId) ?? 0) + 1);
    const [uid] = [...vendedores].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!uid) return;
    const suyas = delRango.filter((v) => v.vendedorId === uid);
    const [r, empresa] = await Promise.all([reporteAstaDelVendedor(uid, RANGO), reporteAstaDeLaEmpresa(RANGO)]);
    expect(r.totales.facturado).toBeCloseTo(suma(suyas), 0);
    expect(r.porVendedor).toBeNull();
    expect(empresa.porVendedor?.find((f) => f.odooUserId === uid)?.facturado).toBeCloseTo(r.totales.facturado, 0);
  }, 120_000);
});

describe('smartbit · la ficha y la cartera dicen lo mismo de un cliente', () => {
  it('el cliente con más Smartbit: su ficha es su historia, y su fila de la cartera también', async () => {
    const porCliente = new Map<number, VentaSmartbit[]>();
    for (const v of delRango) if (v.partnerId) porCliente.set(v.partnerId, [...(porCliente.get(v.partnerId) ?? []), v]);
    const [partnerId, suyas] = [...porCliente].sort((a, b) => suma(b[1]) - suma(a[1]))[0] ?? [];
    if (!partnerId || !suyas) return;

    const ficha = await resumenAstaDeCliente(partnerId, RANGO);
    expect(ficha.totalFacturado).toBeCloseTo(suma(suyas), 0);
    expect(ficha.numeroFacturas).toBe(compras(suyas).length);

    // En la cartera de quien lo tiene asignado hoy, con la misma historia.
    const [p] = await searchRead<{ user_id: [number, string] | false; active: boolean; parent_id: unknown }>('res.partner', [['id', '=', partnerId]], ['user_id', 'active', 'parent_id'], {
      context: { active_test: false },
    });
    if (!p?.user_id || !p.active || p.parent_id) return;
    const t = await totalesAstaDeCartera(p.user_id[0], RANGO, [partnerId]);
    expect(t.get(partnerId)?.total).toBeCloseTo(ficha.totalFacturado, 1);
    expect(t.get(partnerId)?.facturas).toBe(ficha.numeroFacturas);
  }, 120_000);
});
