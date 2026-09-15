import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `almacenDelCliente` con Odoo simulado (#30).
 *
 * El caso que importa —un contacto con compañía distinta a la de su empresa— no
 * se puede probar contra la instancia: hay uno solo, y su empresa raíz no es
 * visible para el usuario de servicio. Sin este fichero, resolver el almacén
 * desde el contacto en vez de desde la empresa pasaba todos los tests
 * (verificado por mutación).
 */

const searchRead = vi.fn();
vi.mock('../odoo/client.js', () => ({ searchRead, executeKw: vi.fn() }));

const { almacenDelCliente, vaciarCachesInventario } = await import('../services/inventory.service.js');

/** Contacto 50 (compañía 9) cuya empresa es la 10 (compañía 7). */
function odooSimulado(opciones: { companiaRaiz?: number | false; almacenes?: Record<number, number> } = {}) {
  const { companiaRaiz = 7, almacenes = { 7: 70, 9: 90 } } = opciones;
  searchRead.mockImplementation(async (modelo: string, dominio: Array<[string, string, unknown]>) => {
    const [, , valor] = dominio[0];
    if (modelo === 'res.partner' && valor === 50) {
      return [{ commercial_partner_id: [10, 'Empresa'], company_id: [9, 'Otra'] }];
    }
    if (modelo === 'res.partner' && valor === 10) {
      return [{ commercial_partner_id: [10, 'Empresa'], company_id: companiaRaiz ? [companiaRaiz, 'X'] : false }];
    }
    if (modelo === 'stock.warehouse') {
      const w = almacenes[valor as number];
      return w ? [{ id: w }] : [];
    }
    throw new Error(`consulta inesperada: ${modelo} ${JSON.stringify(dominio)}`);
  });
}

beforeEach(() => {
  searchRead.mockReset();
  vaciarCachesInventario();
});

describe('#30 · almacenDelCliente', () => {
  it('usa la compañía de la EMPRESA, no la del contacto', async () => {
    odooSimulado();
    expect(await almacenDelCliente(50)).toEqual({ companyId: 7, warehouseId: 70 });
  });

  it('empresa sin compañía → null (el controlador responde 409)', async () => {
    odooSimulado({ companiaRaiz: false });
    expect(await almacenDelCliente(50)).toBeNull();
  });

  it('compañía sin almacén → null', async () => {
    odooSimulado({ almacenes: {} });
    expect(await almacenDelCliente(50)).toBeNull();
  });

  it('se cachea, también el null', async () => {
    odooSimulado({ companiaRaiz: false });
    await almacenDelCliente(50);
    const llamadas = searchRead.mock.calls.length;
    expect(await almacenDelCliente(50)).toBeNull();
    expect(searchRead.mock.calls.length).toBe(llamadas);
  });
});
