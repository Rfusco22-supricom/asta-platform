import { describe, expect, it } from 'vitest';
import { rankingSedeSchema } from '@asta/shared-types';
import { rankingDeSede } from '../services/rankingSede.service.js';

/**
 * El puesto de un vendedor en su sede (el spiff de ASTA), contra Odoo: puesto y
 * nombre, y NUNCA un monto. Que un vendedor vea la cifra de otro no puede
 * depender de la pantalla.
 */

// Un usuario de Odoo con cartera en una sede (el de las cuentas de prueba del vendedor).
const VENDEDOR = 406;
const MES = { desde: '2026-11-01', hasta: '2026-11-30' };

describe('Tu puesto en tu sede', () => {
  it('lleva puesto y nombre de cada uno, sin un solo monto', async () => {
    const r = await rankingDeSede(VENDEDOR, MES);
    expect(rankingSedeSchema.safeParse(r).success).toBe(true);
    for (const f of r.filas) expect(Object.keys(f).sort()).toEqual(['nombre', 'posicion', 'sinVentas', 'tuyo']);
    expect(Object.keys(r).sort()).toEqual(['filas', 'periodo', 'posicion', 'sede', 'total']);
    // Ningún campo con cifras de venta en toda la respuesta.
    expect(JSON.stringify(r)).not.toMatch(/facturado|monto|importe|venta"/i);
  }, 120_000);

  it('él está siempre, una vez, y los puestos van del 1 hacia abajo con empates', async () => {
    const r = await rankingDeSede(VENDEDOR, MES);
    if (!r.sede) return;
    expect(r.filas.filter((f) => f.tuyo)).toHaveLength(1);
    expect(r.posicion).toBe(r.filas.find((f) => f.tuyo)!.posicion);
    expect(r.filas[0]!.posicion).toBe(1);
    for (let i = 1; i < r.filas.length; i++) expect(r.filas[i]!.posicion).toBeGreaterThanOrEqual(r.filas[i - 1]!.posicion);
    expect(r.total).toBe(r.filas.length);
  }, 120_000);
});
