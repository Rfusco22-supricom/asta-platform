import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import '../config/dotenv.js';

/**
 * #43 · Si Odoo no responde, las estadísticas salen igual, sin nombres.
 *
 * Todo el informe es de MySQL salvo el nombre de los productos pulsados. Que Odoo
 * esté caído no puede dejar al administrador sin ver qué buscan los clientes.
 *
 * Odoo simulado y MySQL real. Mayo de 2020, un mes que no usa ningún otro test.
 */

vi.mock('../odoo/client.js', () => ({ searchRead: vi.fn().mockRejectedValue(new Error('Odoo RPC timeout')) }));

const { prisma } = await import('../config/prisma.js');
const { estadisticasRecomendador } = await import('../services/recomendador/estadisticas.service.js');

const MAYO = { gte: new Date(Date.UTC(2020, 4, 1)), lt: new Date(Date.UTC(2020, 5, 1)) };
let comprobado = false;

beforeAll(async () => {
  if (await prisma.recommendationEvent.count({ where: { createdAt: MAYO } })) throw new Error('Ya hay telemetría de mayo de 2020: límpiala a mano.');
  comprobado = true;
  await prisma.recommendationEvent.create({ data: { searchQuery: 'zz odoo caido', resultsCount: 1, clickedProductId: 12345, createdAt: new Date(Date.UTC(2020, 4, 10)) } });
});

afterAll(async () => {
  if (comprobado) await prisma.recommendationEvent.deleteMany({ where: { createdAt: MAYO } });
  await prisma.$disconnect();
});

describe('#43 · Odoo caído', () => {
  it('el informe sale, con el producto sin nombre', async () => {
    const e = await estadisticasRecomendador({ desde: '2020-05-01', hasta: '2020-05-31' });
    expect(e.totales.busquedas).toBe(1);
    expect(e.productos).toEqual([{ productId: 12345, nombre: null, sku: null, clics: 1 }]);
  });
});
