import { afterAll, describe, expect, it, vi } from 'vitest';
import '../config/dotenv.js';

/**
 * #127 · Con Odoo caído, la pestaña Compatibilidades sigue abriendo.
 *
 * Revisar propuestas es trabajo de MySQL. De Odoo solo llegan el importe vendido,
 * que ordena la lista, y el nombre del producto: sin ellos la lista sale igual,
 * ordenada por id, sin nombres, y lo dice. La cobertura del top sí sale vacía,
 * porque sin ventas no hay top.
 *
 * Odoo simulado como caído y MySQL real. Solo se LEE: no hace falta inventar
 * datos, y las propuestas que haya en la base valen para comprobar el orden.
 */

vi.mock('../odoo/client.js', () => {
  const caido = vi.fn().mockRejectedValue(new Error('Odoo RPC timeout'));
  return { executeKw: caido, searchRead: caido, readGroup: caido };
});

const { prisma } = await import('../config/prisma.js');
const { listarParaRevision } = await import('../services/recomendador/revision.service.js');
const { listarImpresorasParaRevision } = await import('../services/recomendador/revisionImpresoras.service.js');
const { coberturaDelTop } = await import('../services/recomendador/cobertura.service.js');

afterAll(async () => {
  await prisma.$disconnect();
});

const consulta = { estado: 'PROPUESTA' as const, pagina: 1, porPagina: 20 };

describe('#127 · Productos', () => {
  it('la lista sale, sin nombres, ordenada por id, y avisa', async () => {
    const r = await listarParaRevision(consulta);

    expect(r.meta.odooDisponible).toBe(false);
    expect(r.data.every((p) => p.nombre === null && p.sku === null && p.ventas12m === 0)).toBe(true);
    const ids = r.data.map((p) => p.templateId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('la búsqueda sigue funcionando por código de cartucho, que está en nuestra base', async () => {
    const algun = await prisma.productCartridge.findFirst({ where: { status: 'PROPUESTA' }, select: { cartridge: { select: { code: true } } } });
    if (!algun) return;

    const r = await listarParaRevision({ ...consulta, q: algun.cartridge.code });
    expect(r.meta.odooDisponible).toBe(false);
    expect(r.data.length).toBeGreaterThan(0);
  });
});

describe('#127 · Impresoras', () => {
  it('la lista sale, ordenada por código de cartucho, y avisa', async () => {
    const r = await listarImpresorasParaRevision(consulta);

    expect(r.meta.odooDisponible).toBe(false);
    expect(r.data.every((c) => c.ventas12m === 0)).toBe(true);
    const codigos = r.data.map((c) => c.codigo);
    expect(codigos).toEqual([...codigos].sort((a, b) => a.localeCompare(b)));
  });
});

describe('#127 · Cobertura del top', () => {
  it('sale vacía y lo dice: sin ventas no hay top, pero la pestaña no se cae', async () => {
    const r = await coberturaDelTop();

    expect(r).toEqual({
      productos: [],
      totales: { top: 0, completos: 0, porcentaje: 0, tramo: 'pospuesta', importeTop: 0, importeCubierto: 0 },
      odooDisponible: false,
    });
  });
});
