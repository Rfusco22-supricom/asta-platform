import type { EstadisticasRecomendador } from '@asta/shared-types';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { searchRead } from '../../odoo/client.js';
import type { RangoPedido } from '../rango.js';
import { normalizarModelo } from './normalizar.js';

/**
 * Estadísticas del recomendador para el panel del SuperAdmin (#43).
 *
 * Lo que pide el issue: búsquedas sin resultado más frecuentes, impresoras más
 * buscadas y quiebres de stock. Más los productos más pulsados, que salen de la
 * misma tabla sin coste.
 *
 * ── Las búsquedas sin resultado, agrupadas por forma normalizada ────────────
 *
 * "HL-2350", "hl 2350" y "HL2350" son la misma búsqueda fallida: contarlas por
 * separado reparte el problema en tres filas pequeñas que no llaman la atención.
 * Se agrupan con `normalizarModelo` —la misma función que usa la búsqueda, así
 * que lo que se agrupa es exactamente lo que la búsqueda trata como igual— y se
 * conserva el texto más frecuente como ejemplo, que es el alias a añadir.
 *
 * ── Fechas ────────────────────────────────────────────────────────────────────
 *
 * `desde` y `hasta` son días enteros, incluidos, en UTC: `created_at` está en
 * UTC. Mismo rango y mismas reglas que los reportes (`rangoDeLaPeticion`).
 */

export const TOPE_FILAS = 20;

function limitesDe(rango: RangoPedido): Prisma.DateTimeFilter {
  const fin = new Date(`${rango.hasta}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { gte: new Date(`${rango.desde}T00:00:00Z`), lt: fin };
}

export async function estadisticasRecomendador(rango: RangoPedido): Promise<EstadisticasRecomendador> {
  const createdAt = limitesDe(rango);
  const busqueda: Prisma.RecommendationEventWhereInput = { createdAt, searchQuery: { not: '' } };

  const [busquedas, sinResultado, conImpresora, conClic, quiebres, consultasDirectas] = await Promise.all([
    prisma.recommendationEvent.count({ where: busqueda }),
    prisma.recommendationEvent.count({ where: { ...busqueda, resultsCount: 0 } }),
    prisma.recommendationEvent.count({ where: { ...busqueda, matchedPrinterId: { not: null } } }),
    prisma.recommendationEvent.count({ where: { ...busqueda, clickedProductId: { not: null } } }),
    prisma.recommendationEvent.count({ where: { createdAt, wasOutOfStock: true } }),
    prisma.recommendationEvent.count({ where: { createdAt, searchQuery: '' } }),
  ]);

  // ── Sin resultado ─────────────────────────────────────────────────────────
  // La agrupación por texto exacto la hace MySQL; la fusión por forma
  // normalizada, aquí. Son pocas filas: cada texto distinto una vez.
  const porTexto = await prisma.recommendationEvent.groupBy({
    by: ['searchQuery'],
    where: { ...busqueda, resultsCount: 0 },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const grupos = new Map<string, { textos: Array<{ texto: string; veces: number }>; veces: number; ultimaVez: Date }>();
  for (const g of porTexto) {
    const clave = normalizarModelo(g.searchQuery) || g.searchQuery.trim().toLowerCase();
    const grupo = grupos.get(clave) ?? { textos: [], veces: 0, ultimaVez: new Date(0) };
    grupo.textos.push({ texto: g.searchQuery, veces: g._count._all });
    grupo.veces += g._count._all;
    if (g._max.createdAt && g._max.createdAt > grupo.ultimaVez) grupo.ultimaVez = g._max.createdAt;
    grupos.set(clave, grupo);
  }
  const sinResultadoTop = [...grupos.entries()]
    .sort((a, b) => b[1].veces - a[1].veces || b[1].ultimaVez.getTime() - a[1].ultimaVez.getTime())
    .slice(0, TOPE_FILAS)
    .map(([normalizada, g]) => ({
      normalizada,
      // El más frecuente; a igualdad, el primero en orden alfabético, para que no
      // cambie de una carga a otra.
      ejemplo: [...g.textos].sort((a, b) => b.veces - a.veces || a.texto.localeCompare(b.texto))[0].texto.trim(),
      variantes: g.textos.length,
      veces: g.veces,
      ultimaVez: g.ultimaVez.toISOString(),
    }));

  // ── Impresoras ────────────────────────────────────────────────────────────
  const [porImpresora, quiebresPorImpresora] = await Promise.all([
    prisma.recommendationEvent.groupBy({
      by: ['matchedPrinterId'],
      where: { createdAt, matchedPrinterId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { matchedPrinterId: 'desc' } },
      take: TOPE_FILAS,
    }),
    prisma.recommendationEvent.groupBy({
      by: ['matchedPrinterId'],
      where: { createdAt, matchedPrinterId: { not: null }, wasOutOfStock: true },
      _count: { _all: true },
    }),
  ]);
  const idsImpresora = porImpresora.map((g) => g.matchedPrinterId!);
  const modelos = await prisma.printerModel.findMany({
    where: { id: { in: idsImpresora } },
    select: { id: true, name: true, brand: { select: { name: true } } },
  });
  const modeloDe = new Map(modelos.map((m) => [m.id, m]));
  const quiebreDe = new Map(quiebresPorImpresora.map((g) => [g.matchedPrinterId!, g._count._all]));
  const impresoras = porImpresora.map((g) => {
    const m = modeloDe.get(g.matchedPrinterId!);
    return {
      printerModelId: g.matchedPrinterId!,
      marca: m?.brand.name ?? null,
      nombre: m?.name ?? null,
      veces: g._count._all,
      quiebres: quiebreDe.get(g.matchedPrinterId!) ?? 0,
    };
  });

  // ── Productos pulsados ────────────────────────────────────────────────────
  const porProducto = await prisma.recommendationEvent.groupBy({
    by: ['clickedProductId'],
    where: { createdAt, clickedProductId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { clickedProductId: 'desc' } },
    take: TOPE_FILAS,
  });
  const nombres = new Map<number, { nombre: string; sku: string | null }>();
  if (porProducto.length > 0) {
    try {
      const filas = await searchRead<{ id: number; name: string; default_code: string | false }>(
        'product.product',
        [['id', 'in', porProducto.map((g) => g.clickedProductId!)]],
        ['name', 'default_code'],
        { context: { active_test: false } },
      );
      for (const f of filas) nombres.set(f.id, { nombre: f.name, sku: f.default_code || null });
    } catch {
      // Sin Odoo, el informe sale con los ids: lo demás es de MySQL y vale igual.
    }
  }
  const productos = porProducto.map((g) => ({
    productId: g.clickedProductId!,
    nombre: nombres.get(g.clickedProductId!)?.nombre ?? null,
    sku: nombres.get(g.clickedProductId!)?.sku ?? null,
    clics: g._count._all,
  }));

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    totales: { busquedas, sinResultado, conImpresora, conClic, quiebres, consultasDirectas },
    sinResultado: sinResultadoTop,
    impresoras,
    productos,
  };
}
