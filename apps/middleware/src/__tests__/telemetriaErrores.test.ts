import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCompatibleItem } from '@asta/shared-types';

/**
 * #43 · La telemetría nunca tumba una petición, y sus piezas puras.
 *
 * Prisma simulado: el caso que importa es que MySQL falle al escribir, y eso no
 * se provoca contra la base real.
 */

const create = vi.fn();
const updateMany = vi.fn();
vi.mock('../config/prisma.js', () => ({ prisma: { recommendationEvent: { create, updateMany } } }));

const { hayQuiebre, leerBusquedaId, registrarBusqueda, registrarConsulta } = await import('../services/recomendador/telemetria.service.js');

const item = (stock: PublicCompatibleItem['stock']): PublicCompatibleItem => ({ id: 1, templateId: 1, sku: null, nombre: 'x', stock, tipo: 'original', cartuchos: [] });
const log = () => ({ warn: vi.fn() });

beforeEach(() => {
  create.mockReset();
  updateMany.mockReset();
});

describe('#43 · Si MySQL falla, la búsqueda sigue', () => {
  it('registrarBusqueda devuelve null y lo avisa, sin lanzar', async () => {
    create.mockRejectedValue(new Error("Can't reach database server"));
    const l = log();
    await expect(registrarBusqueda({ userId: 'u', consulta: 'hl2350', coincidencias: [1] }, l)).resolves.toBeNull();
    expect(l.warn).toHaveBeenCalled();
  });

  it('registrarConsulta tampoco lanza, con ni sin busquedaId', async () => {
    updateMany.mockRejectedValue(new Error('caída'));
    create.mockRejectedValue(new Error('caída'));
    for (const busquedaId of [5n, null]) {
      const l = log();
      await expect(registrarConsulta({ userId: 'u', busquedaId, printerId: 1, items: [], soloDisponibles: false }, l)).resolves.toBeUndefined();
      expect(l.warn).toHaveBeenCalled();
    }
  });
});

describe('#43 · Lo que se escribe', () => {
  it('la consulta se guarda cruda, solo recortada a la columna', async () => {
    create.mockResolvedValue({ id: 7n });
    const larga = `  HL-L2350 ${'x'.repeat(300)}`;
    expect(await registrarBusqueda({ userId: 'u', consulta: larga, coincidencias: [] })).toBe('7');
    expect(create.mock.lastCall?.[0].data.searchQuery).toBe(larga.slice(0, 200));
  });

  it('una busquedaId ajena o caducada no se toca: la consulta va a una fila propia', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    create.mockResolvedValue({});
    await registrarConsulta({ userId: 'u', busquedaId: 5n, printerId: 3, items: [item('agotado')], soloDisponibles: false }, log());
    expect(updateMany.mock.lastCall?.[0].where).toMatchObject({ id: 5n, userId: 'u' });
    expect(create.mock.lastCall?.[0].data).toMatchObject({ userId: 'u', searchQuery: '', matchedPrinterId: 3, wasOutOfStock: true });
  });

  it('con soloDisponibles no se escribe wasOutOfStock en la fila de la búsqueda', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await registrarConsulta({ userId: 'u', busquedaId: 5n, printerId: 3, items: [], soloDisponibles: true }, log());
    expect(updateMany.mock.lastCall?.[0].data).toEqual({ matchedPrinterId: 3 });
  });
});

describe('#43 · hayQuiebre', () => {
  it('solo si había productos y ninguno con existencia', () => {
    expect(hayQuiebre([])).toBe(false);
    expect(hayQuiebre([item('agotado'), item('agotado')])).toBe(true);
    expect(hayQuiebre([item('agotado'), item('bajo')])).toBe(false);
    expect(hayQuiebre([item('disponible')])).toBe(false);
  });
});

describe('#43 · leerBusquedaId', () => {
  it('acepta el id tal como lo devolvió la búsqueda, y nada más', () => {
    expect(leerBusquedaId('123')).toBe(123n);
    expect(leerBusquedaId('9223372036854775807')).toBe(9223372036854775807n);
    for (const malo of ['', '0', '01', '-1', '1.5', 'abc', '12345678901234567890', 123, null, undefined]) {
      expect(leerBusquedaId(malo), String(malo)).toBeNull();
    }
  });
});
