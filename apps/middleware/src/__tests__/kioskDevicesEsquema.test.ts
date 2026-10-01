import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';

/**
 * #120 · Lo que Track B necesita de `kiosk_devices`, contra MySQL de verdad.
 *
 *   · la tablet sabe de qué compañía y almacén es, y no se puede dar de alta sin;
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

  it('sin almacén no hay alta por Prisma, que es por donde se dan de alta', async () => {
    await expect(
      prisma.kioskDevice.create({
        // @ts-expect-error — falta odooWarehouseId: es lo que se comprueba.
        data: { label: ETIQUETA, storeLocation: 'Pruebas', odooCompanyId: 10, tokenHash: hash('8') },
      }),
    ).rejects.toThrow(/odooWarehouseId/);
  });

  it('ni por SQL: la columna es NOT NULL sin valor por defecto', async () => {
    /*
     * En modo estricto. La MariaDB de desarrollo (XAMPP) no lo está —medido el
     * 2026-10-01—, y ahí el INSERT entra con un 0, aunque `001_schema.sql` diga
     * que el servidor DEBE estar en modo estricto. Producción, MySQL 9, lo está
     * por defecto. Se fuerza en la sesión para medir el esquema, no la
     * configuración del servidor.
     */
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'`);
        await tx.$executeRaw`INSERT INTO kiosk_devices (id, label, store_location, odoo_company_id, token_hash) VALUES (UUID(), ${ETIQUETA}, 'Pruebas', 10, ${hash('9')})`;
      }),
    ).rejects.toThrow(/odoo_warehouse_id/);
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
