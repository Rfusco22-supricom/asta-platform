import { describe, expect, it } from 'vitest';
import { parteAsta, saldoAsta } from '../services/ventasAsta.service.js';

/**
 * La parte ASTA de una factura (solo montos de ASTA, 2026-11-10): Odoo guarda
 * el pago por factura, así que el saldo se reparte por lo que la factura lleva
 * de ASTA.
 */
describe('parte ASTA de una factura', () => {
  it('proporción de lo ASTA sobre la base imponible, de 0 a 1', () => {
    expect(parteAsta(300, 1000)).toBe(0.3);
    expect(parteAsta(1000, 1000)).toBe(1);
    expect(parteAsta(0, 1000)).toBe(0);
    // Redondeos de Odoo: nunca más del 100 %, ni negativa.
    expect(parteAsta(1000.01, 1000)).toBe(1);
    expect(parteAsta(-5, 1000)).toBe(0);
    // Sin base (una factura a cero) no hay parte.
    expect(parteAsta(10, 0)).toBe(0);
  });

  it('una nota de crédito lleva las dos cifras en negativo', () => {
    expect(parteAsta(-200, -800)).toBe(0.25);
    expect(saldoAsta(-928, -200, -800)).toBe(-232);
  });

  it('el saldo de ASTA: el saldo con IVA por la parte ASTA', () => {
    // Factura de 1.160 con IVA (1.000 de base), 300 de ASTA y debe 580: 30 % de 580.
    expect(saldoAsta(580, 300, 1000)).toBeCloseTo(174);
    expect(saldoAsta(0, 300, 1000)).toBe(0);
  });
});

describe('un nombre de producto es de ASTA', () => {
  it('lleva la palabra ASTA, al principio o no; los originales con la marca mal puesta, no', async () => {
    const { esNombreAsta } = await import('../services/flyers.service.js');
    expect(['ASTA TONER HP W1500A', 'TONER ASTA W1105A NO CHIP VERSION 4', 'ASTA CHIP A-CRG.057H ORIGINAL RECYCLE CHIP'].every(esNombreAsta)).toBe(true);
    expect(['[CRG-047] TONER CANON NEGRO, LASERJET ORIGINAL', 'BOTELLA DE TINTA ORIGINAL CANON GI-10 BLACK 170 ml', 'HP DRUM CRG-051D/CF232A', 'PASTA TERMICA'].some(esNombreAsta)).toBe(false);
  });
});
