import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../config/prisma.js';

/**
 * El nivel de cada cuenta es su categoría de ASTA (#131).
 *
 * Odoo y el cálculo de categorías se simulan: tres grupos de cliente por RIF
 * (uno Oro, uno Plata y uno sin compra), y una cuenta de staff que no se toca.
 */

const RIF_ORO = 'J999000111';
const RIF_PLATA = 'J999000222';
const PARTNER = { oro1: 3_970_000_001, oro2: 3_970_000_002, plata: 3_970_000_003, nada: 3_970_000_004, staff: 3_970_000_005 };

vi.mock('../services/categoriasAsta.service.js', () => ({
  categoriasAsta: async () => ({
    meses: ['2026-06', '2026-07', '2026-08', '2026-09'],
    compraMensual: 0,
    meta: 100000,
    porCategoria: [],
    clientes: [
      { clave: RIF_ORO, categoria: 'ORO' },
      { clave: RIF_PLATA, categoria: 'PLATA' },
    ],
  }),
}));

vi.mock('../odoo/client.js', async (original) => {
  const real = await original<typeof import('../odoo/client.js')>();
  const fichas: Record<number, { vat: string | false }> = {
    // Dos fichas del mismo RIF, escrito de dos formas: las dos son Oro.
    [PARTNER.oro1]: { vat: 'J-99900011-1' },
    [PARTNER.oro2]: { vat: 'J999000111' },
    [PARTNER.plata]: { vat: 'J-99900022-2' },
    [PARTNER.nada]: { vat: false },
    [PARTNER.staff]: { vat: 'J999000111' },
  };
  return {
    ...real,
    searchRead: async (_modelo: string, dominio: Array<[string, string, number[]]>) =>
      dominio[0]![2].filter((id) => fichas[id]).map((id) => ({ id, vat: fichas[id]!.vat, commercial_partner_id: [id, 'x'] })),
  };
});

const { aplicarNiveles, claveDeFicha } = await import('../services/nivelesCliente.service.js');

const EMAIL = (k: string) => `test.niveles.${k}@niveles.local`;

beforeAll(async () => {
  if (await prisma.appUser.count({ where: { email: { endsWith: '@niveles.local' } } })) throw new Error('Restos de @niveles.local: límpialos a mano.');
  const crear = (k: keyof typeof PARTNER, role: 'BRONCE' | 'VENDEDOR') =>
    prisma.appUser.create({ data: { email: EMAIL(k), fullName: k, role, odooPartnerId: PARTNER[k], isActive: true } });
  await crear('oro1', 'BRONCE');
  await crear('oro2', 'BRONCE');
  await crear('plata', 'BRONCE');
  await crear('nada', 'BRONCE');
  // Un vendedor cuyo partner tiene el RIF de un cliente Oro: no se toca.
  await crear('staff', 'VENDEDOR');
});

afterAll(async () => {
  await prisma.appUser.deleteMany({ where: { email: { endsWith: '@niveles.local' } } });
  await prisma.$disconnect();
});

const rol = async (k: keyof typeof PARTNER) => (await prisma.appUser.findUniqueOrThrow({ where: { email: EMAIL(k) } })).role;

describe('claveDeFicha', () => {
  it('el RIF normalizado, o la ficha comercial si no hay RIF que sirva', () => {
    expect(claveDeFicha('J-99900011-1', 1)).toBe('J999000111');
    expect(claveDeFicha(false, 42)).toBe('p42');
    expect(claveDeFicha('000000000', 42)).toBe('p42');
  });
});

describe('aplicarNiveles, contra MySQL', () => {
  it('el simulacro dice qué cambiaría y no escribe nada', async () => {
    const r = await aplicarNiveles({ aplicar: false });
    expect(r.movimientos['BRONCE → GOLD']).toBeGreaterThanOrEqual(2);
    expect(await rol('oro1')).toBe('BRONCE');
  });

  it('cada cuenta toma el nivel de su grupo por RIF; sin compra, Cliente general; el staff no se toca', async () => {
    await aplicarNiveles({ aplicar: true });
    expect(await rol('oro1')).toBe('GOLD');
    expect(await rol('oro2')).toBe('GOLD');
    expect(await rol('plata')).toBe('PLATA');
    expect(await rol('nada')).toBe('GENERAL');
    expect(await rol('staff')).toBe('VENDEDOR');
  });

  it('una segunda pasada no cambia nada de lo nuestro', async () => {
    const r = await aplicarNiveles({ aplicar: false });
    expect(r.movimientos['BRONCE → GOLD'] ?? 0).toBe(0);
  });
});
