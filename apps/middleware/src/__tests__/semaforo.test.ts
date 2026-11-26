import { describe, expect, it } from 'vitest';
import { DIAS_SIN_ASTA, colorDe, diasDesde, semaforoSchema, tamanoDe } from '@asta/shared-types';
import { modeloDelProducto, semaforoClientes } from '../services/semaforo.service.js';

/**
 * El semáforo de clientes: las reglas del color y del tamaño, el reconocimiento
 * de impresoras (sin accesorios), y la respuesta contra Odoo: solo ASTA, sin
 * montos, y la cartera del vendedor y nada más.
 */

// Un usuario de Odoo con cartera (el de las cuentas de prueba del vendedor).
const VENDEDOR = 406;

describe('Semáforo: reglas', () => {
  it('el color sale de las impresoras con tóner ASTA y las cubiertas', () => {
    expect(colorDe(0, 0)).toBeNull();
    expect(colorDe(3, 0)).toBe('ROJO');
    expect(colorDe(3, 1)).toBe('AMARILLO');
    expect(colorDe(3, 3)).toBe('VERDE');
  });

  it('si lleva más de 90 días sin comprar ASTA, baja un color', () => {
    expect(colorDe(3, 3, DIAS_SIN_ASTA)).toBe('VERDE');
    expect(colorDe(3, 3, DIAS_SIN_ASTA + 1)).toBe('AMARILLO');
    expect(colorDe(3, 1, 10)).toBe('AMARILLO');
    expect(colorDe(3, 1, 200)).toBe('ROJO');
    // Rojo ya es lo más bajo.
    expect(colorDe(3, 0, 200)).toBe('ROJO');
    expect(colorDe(3, 3, null)).toBe('AMARILLO');
    expect(diasDesde('2026-11-01', '2026-11-25')).toBe(24);
    expect(diasDesde(null, '2026-11-25')).toBeNull();
  });

  it('el tamaño: el 20 % que más compra es grande, el 30 % siguiente mediana', () => {
    expect(tamanoDe(1)).toBe('GRANDE');
    expect(tamanoDe(0.8)).toBe('GRANDE');
    expect(tamanoDe(0.79)).toBe('MEDIANA');
    expect(tamanoDe(0.5)).toBe('MEDIANA');
    expect(tamanoDe(0.49)).toBe('PEQUENA');
    expect(tamanoDe(0)).toBe('PEQUENA');
  });

  it('reconoce la impresora del producto y descarta los accesorios de la categoría', () => {
    const modelos = new Map([['canon', [{ id: 7, nombre: 'Canon imageCLASS LBP6030w', nameNormalized: 'imageclasslbp6030w' }]]]);
    expect(modeloDelProducto('CANON IMAGECLASS LBP6030W - IMPRESORA LASER', null, modelos)).toEqual(modelos.get('canon')![0]);
    // Una impresora que no está en la base: se enseña, sin tóner.
    expect(modeloDelProducto('CANON IMPRESORA PIXMA TS3610 MULTIFUNCIONAL', null, modelos)).toBeNull();
    // Lo que no es impresora no cuenta.
    expect(modeloDelProducto('CANON BANDEJA UNIT AR1', null, modelos)).toBeUndefined();
    expect(modeloDelProducto('CANON PLACA DE LAN INALAMBRICA WIRELESS LAN BOARD-D1', null, modelos)).toBeUndefined();
  });
});

describe('Semáforo contra Odoo', () => {
  it('cumple el contrato, sin montos, y cada cliente tiene su color bien puesto', async () => {
    const r = await semaforoClientes({ odooUserId: VENDEDOR });
    expect(semaforoSchema.safeParse(r).success).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/facturado|monto|importe|amount|price/i);
    for (const c of r.clientes) {
      expect(c.vendedor).toBeNull();
      expect(c.color).toBe(colorDe(c.conAsta, c.cubiertas, c.diasSinAsta));
      expect(c.enfriado).toBe(c.color !== colorDe(c.conAsta, c.cubiertas));
      expect(c.diasSinAsta).toBe(diasDesde(c.ultimaCompraAsta, r.hasta));
      // Quien tiene una impresora cubierta compró ASTA en el periodo.
      if (c.cubiertas > 0) expect(c.ultimaCompraAsta).not.toBeNull();
      expect(c.conAsta).toBe(c.detalle.filter((i) => i.toners.length > 0).length);
      expect(c.cubiertas).toBe(c.detalle.filter((i) => i.toners.some((t) => t.comprado)).length);
    }
    expect(r.totales.ROJO + r.totales.AMARILLO + r.totales.VERDE).toBe(r.clientes.length);
  }, 180_000);

  it('el vendedor solo ve su cartera: sus clientes están en el de la empresa con él de vendedor', async () => {
    const [suyo, empresa] = await Promise.all([semaforoClientes({ odooUserId: VENDEDOR }), semaforoClientes({ odooUserId: null })]);
    const deLaEmpresa = new Map(empresa.clientes.map((c) => [c.partnerId, c]));
    const nombres = new Set(suyo.clientes.map((c) => deLaEmpresa.get(c.partnerId)?.vendedor));
    for (const c of suyo.clientes) expect(deLaEmpresa.has(c.partnerId)).toBe(true);
    // Todos del mismo vendedor.
    expect(nombres.size).toBeLessThanOrEqual(1);
  }, 240_000);

  it('con un periodo, todo se mira dentro de él', async () => {
    const rango = { desde: '2026-10-01', hasta: '2026-10-31' };
    const r = await semaforoClientes({ odooUserId: VENDEDOR, rango });
    expect(semaforoSchema.safeParse(r).success).toBe(true);
    expect({ desde: r.desde, hasta: r.hasta }).toEqual(rango);
    for (const c of r.clientes) {
      if (c.ultimaCompraAsta) {
        expect(c.ultimaCompraAsta >= rango.desde && c.ultimaCompraAsta <= rango.hasta).toBe(true);
        expect(c.diasSinAsta).toBe(diasDesde(c.ultimaCompraAsta, rango.hasta));
      }
    }
    // Un mes tiene menos impresoras vendidas que doce.
    const anio = await semaforoClientes({ odooUserId: VENDEDOR });
    expect(r.totales.impresoras).toBeLessThanOrEqual(anio.totales.impresoras);
  }, 240_000);
});
