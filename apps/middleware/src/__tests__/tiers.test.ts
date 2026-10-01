import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { DEFAULT_TIER, isUnmappedPricelist, tierFromPricelist } from '../config/tiers.js';
import { cargarMapaTiers, construirMapa, vaciarCacheTiers } from '../services/tiers.service.js';
import { cambioElMapeo, sincronizarPartners } from '../services/sync.service.js';

/**
 * #131 · El nivel sale de `tier_pricelist_map`, no de código.
 *
 * Contra la MySQL de desarrollo. Las tarifas de prueba llevan ids que no existen
 * en Odoo (999.990.xxx) y se borran al terminar.
 */

const TARIFA_GOLD = 999_990_001;
const TARIFA_PLATA = 999_990_002;

beforeEach(() => vaciarCacheTiers());

afterAll(async () => {
  await prisma.tierPricelistMap.deleteMany({ where: { odooPricelistId: { in: [TARIFA_GOLD, TARIFA_PLATA] } } });
  vaciarCacheTiers();
  await prisma.$disconnect();
});

describe('#131 · El mapeo se lee de la tabla', () => {
  it('una tarifa dada de alta en la tabla da su nivel, sin desplegar nada', async () => {
    await prisma.tierPricelistMap.create({ data: { odooPricelistId: TARIFA_GOLD, pricelistName: 'Prueba #131', tier: 'GOLD' } });
    const mapa = await cargarMapaTiers();
    expect(tierFromPricelist(TARIFA_GOLD, mapa)).toBe('GOLD');
    expect(isUnmappedPricelist(TARIFA_GOLD, mapa)).toBe(false);
  });

  it('una tarifa que no está en la tabla es BRONCE, y se marca como sin mapear', async () => {
    const mapa = await cargarMapaTiers();
    expect(tierFromPricelist(TARIFA_PLATA, mapa)).toBe(DEFAULT_TIER);
    expect(isUnmappedPricelist(TARIFA_PLATA, mapa)).toBe(true);
  });

  it('sin tarifa es BRONCE, y no cuenta como «sin mapear»: no hay nada que mapear', async () => {
    const mapa = await cargarMapaTiers();
    expect(tierFromPricelist(null, mapa)).toBe(DEFAULT_TIER);
    expect(isUnmappedPricelist(null, mapa)).toBe(false);
  });

  it('mover una tarifa de nivel en la tabla cambia el nivel en la siguiente lectura', async () => {
    await prisma.tierPricelistMap.upsert({
      where: { odooPricelistId: TARIFA_GOLD },
      create: { odooPricelistId: TARIFA_GOLD, pricelistName: 'Prueba #131', tier: 'GOLD' },
      update: { tier: 'GOLD' },
    });
    const antes = await cargarMapaTiers();
    await prisma.tierPricelistMap.update({ where: { odooPricelistId: TARIFA_GOLD }, data: { tier: 'PLATA' } });
    vaciarCacheTiers();
    const despues = await cargarMapaTiers();
    expect(tierFromPricelist(TARIFA_GOLD, antes)).toBe('GOLD');
    expect(tierFromPricelist(TARIFA_GOLD, despues)).toBe('PLATA');
    expect(despues.huella).not.toBe(antes.huella);
  });
});

describe('#131 · Si la base falla', () => {
  it('sin nada en cache, LANZA: nunca un mapeo vacío que degrade a todos a BRONCE', async () => {
    const leer = async () => {
      throw new Error('MySQL caído');
    };
    await expect(cargarMapaTiers(leer)).rejects.toThrow('MySQL caído');
  });

  it('con un mapeo ya leído, sigue usando ese aunque haya caducado', async () => {
    let t = 0;
    const ahora = () => t;
    await cargarMapaTiers(async () => [{ odooPricelistId: TARIFA_GOLD, tier: 'GOLD' }], ahora);
    t = 10 * 60_000;
    const mapa = await cargarMapaTiers(async () => {
      throw new Error('MySQL caído');
    }, ahora);
    expect(tierFromPricelist(TARIFA_GOLD, mapa)).toBe('GOLD');
  });

  it('dentro de los 60 s no vuelve a consultar', async () => {
    let lecturas = 0;
    const leer = async () => {
      lecturas++;
      return [];
    };
    let t = 0;
    await cargarMapaTiers(leer, () => t);
    t = 59_000;
    await cargarMapaTiers(leer, () => t);
    expect(lecturas).toBe(1);
    t = 61_000;
    await cargarMapaTiers(leer, () => t);
    expect(lecturas).toBe(2);
  });
});

describe('#131 · El sync relee a todos cuando cambia el mapeo', () => {
  const mapa = construirMapa([{ odooPricelistId: 15863, tier: 'BRONCE' }]);

  it('la huella no depende del orden de las filas', () => {
    const a = construirMapa([{ odooPricelistId: 1, tier: 'GOLD' }, { odooPricelistId: 2, tier: 'PLATA' }]);
    const b = construirMapa([{ odooPricelistId: 2, tier: 'PLATA' }, { odooPricelistId: 1, tier: 'GOLD' }]);
    expect(a.huella).toBe(b.huella);
  });

  it('con la misma huella que la pasada anterior, el sync sigue siendo incremental', () => {
    expect(cambioElMapeo({ huellaTiers: mapa.huella }, mapa.huella)).toBe(false);
  });

  it('si la huella cambió, la pasada es completa', () => {
    const movida = construirMapa([{ odooPricelistId: 15863, tier: 'GOLD' }]);
    expect(cambioElMapeo({ huellaTiers: mapa.huella }, movida.huella)).toBe(true);
  });

  it('sin huella guardada (primera pasada con #131, o resumen vacío), también completa', () => {
    expect(cambioElMapeo(null, mapa.huella)).toBe(true);
    expect(cambioElMapeo({ leidos: 10 }, mapa.huella)).toBe(true);
  });
});

describe('#131 · De verdad: el sync decide la pasada por la huella', () => {
  // Contra Odoo (solo lectura) y la base de desarrollo, con `limite: 3`. Se
  // restaura `sync_state` y se borran las cuentas que cree, para no dejar rastro.
  it('huella vieja → pasada completa; misma huella → incremental', async () => {
    const estado = await prisma.syncState.findUnique({ where: { entidad: 'res.partner' } });
    const antes = new Set((await prisma.appUser.findMany({ select: { id: true } })).map((u) => u.id));
    try {
      await prisma.syncState.upsert({
        where: { entidad: 'res.partner' },
        create: { entidad: 'res.partner', ultimoWriteDate: '2026-09-30 00:00:00', resumen: { huellaTiers: 'vieja' } },
        update: { ultimoWriteDate: '2026-09-30 00:00:00', resumen: { huellaTiers: 'vieja' }, ejecutando: false },
      });
      const primera = await sincronizarPartners({ limite: 3 });
      expect(primera.completoPorTiers).toBe(true);
      expect(primera.desde).toBeNull();

      const segunda = await sincronizarPartners({ limite: 3 });
      expect(segunda.completoPorTiers).toBeUndefined();
      expect(segunda.desde).not.toBeNull();
      expect(segunda.huellaTiers).toBe(primera.huellaTiers);
    } finally {
      const nuevos = (await prisma.appUser.findMany({ select: { id: true } })).map((u) => u.id).filter((id) => !antes.has(id));
      await prisma.appUser.deleteMany({ where: { id: { in: nuevos } } });
      if (estado) {
        const { entidad, ...resto } = estado;
        await prisma.syncState.update({ where: { entidad }, data: { ...resto, resumen: (resto.resumen ?? undefined) as never } });
      } else {
        await prisma.syncState.deleteMany({ where: { entidad: 'res.partner' } });
      }
    }
  }, 180_000);
});
