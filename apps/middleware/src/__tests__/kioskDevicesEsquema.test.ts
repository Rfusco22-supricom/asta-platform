import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';

/**
 * #120 · Lo que Track B necesita de `kiosk_devices`, contra MySQL de verdad.
 *
 *   · la tablet sabe de qué compañía y almacén es; sin ellos, solo compatibilidades;
 *   · el token anterior a la rotación se guarda aparte, y como el actual, un hash
 *     no puede apuntar a dos tablets: la autenticación busca por los dos.
 *
 * Dispositivos con la etiqueta `ZZ_KIOSK_120`, que no usa nadie más.
 */

const ETIQUETA = 'ZZ_KIOSK_120';
const hash = (c: string) => c.repeat(64);
let comprobado = false;

const limpiar = () => prisma.kioskDevice.deleteMany({ where: { label: ETIQUETA } });

beforeAll(async () => {
  if (await prisma.kioskDevice.count({ where: { label: ETIQUETA } })) throw new Error(`Ya hay dispositivos ${ETIQUETA}: límpialos a mano.`);
  comprobado = true;
});

beforeEach(async () => {
  if (comprobado) await limpiar();
});

afterAll(async () => {
  if (comprobado) await limpiar();
  await prisma.$disconnect();
});

const alta = (extra: Record<string, unknown> = {}) =>
  prisma.kioskDevice.create({
    data: { label: ETIQUETA, storeLocation: 'Pruebas', odooCompanyId: 10, odooWarehouseId: 3, tokenHash: hash('1'), ...extra },
  });

describe('#120 · El almacén de la tablet', () => {
  it('se guarda con la compañía y el almacén de Odoo', async () => {
    const d = await alta();
    expect(d).toMatchObject({ odooCompanyId: 10, odooWarehouseId: 3, tokenHashAnterior: null, tokenRotadoEn: null });
  });

  /*
   * Antes, sin almacén no había alta. Ahora es a propósito: las tablets de los
   * clientes y las de los revisores de las tiendas de apps no tienen almacén y
   * enseñan solo compatibilidades.
   */
  it('sin almacén también: una tablet de solo compatibilidades, con su cliente dueño', async () => {
    const d = await prisma.kioskDevice.create({
      data: { label: ETIQUETA, storeLocation: 'Pruebas', odooPartnerId: 3_820_123_456, tokenHash: hash('8') },
    });
    expect(d).toMatchObject({ odooCompanyId: null, odooWarehouseId: null, odooPartnerId: 3_820_123_456 });
  });
});

describe('#120 · El token anterior a la rotación', () => {
  it('convive con el nuevo, con la fecha de rotación', async () => {
    const rotado = new Date('2026-10-01T08:00:00Z');
    const d = await alta({ tokenHash: hash('2'), tokenHashAnterior: hash('1'), tokenRotadoEn: rotado });
    expect(d).toMatchObject({ tokenHash: hash('2'), tokenHashAnterior: hash('1'), tokenRotadoEn: rotado });
  });

  it('dos tablets sin token anterior no chocan: el índice único admite varios NULL', async () => {
    await alta({ tokenHash: hash('3') });
    await expect(alta({ tokenHash: hash('4') })).resolves.toBeTruthy();
  });

  it('un mismo hash anterior no puede apuntar a dos tablets', async () => {
    await alta({ tokenHash: hash('5'), tokenHashAnterior: hash('a') });
    await expect(alta({ tokenHash: hash('6'), tokenHashAnterior: hash('a') })).rejects.toThrow();
  });
});
