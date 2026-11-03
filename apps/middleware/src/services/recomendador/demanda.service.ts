import { TOPE_DEMANDA, type CartuchoDemandado, type DemandaAsta, type EstadoDemanda, type ImpresoraDemandada, type SedeId } from '@asta/shared-types';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { executeKw } from '../../odoo/client.js';
import { CacheTtl } from '../../utils/cacheTtl.js';
import { MARCA_ASTA } from '../asta.service.js';
import type { RangoPedido } from '../rango.js';

/**
 * La demanda no cubierta de ASTA (reglas en `@asta/shared-types`,
 * `demandaAsta.ts`): las impresoras que se buscan en la aplicación ASTA y para
 * las que ASTA no tiene producto, y los cartuchos que las cubrirían.
 *
 * Sale de `recommendation_events` (una fila por búsqueda, ver
 * `telemetria.service`) cruzada con las compatibilidades de HOY. «Producto
 * ASTA» es lo mismo que enseña la aplicación: una plantilla de la marca, a la
 * venta y almacenable, con la compatibilidad VALIDADA.
 *
 * La sede es la de la tablet (su compañía de Odoo). Las búsquedas por API, sin
 * tablet, solo cuentan en «Todas las sedes».
 */

/** Las plantillas ASTA que la aplicación puede enseñar. Cambian poco: una hora. */
const cachePlantillas = new CacheTtl<Set<number>>(3600_000, 1);

async function plantillasAsta(): Promise<Set<number>> {
  const enCache = cachePlantillas.get('asta');
  if (enCache) return enCache;
  const ids = await executeKw<number[]>('product.template', 'search', [
    [
      ['spiff_brand_id', '=', MARCA_ASTA],
      ['sale_ok', '=', true],
      ['detailed_type', '=', 'product'],
    ],
  ]);
  const r = new Set(ids);
  cachePlantillas.set('asta', r);
  return r;
}

function limitesDe(rango: RangoPedido): Prisma.DateTimeFilter {
  const fin = new Date(`${rango.hasta}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { gte: new Date(`${rango.desde}T00:00:00Z`), lt: fin };
}

/** Lo que se sabe de una impresora para clasificarla. */
export interface Compatibilidades {
  /** Cartuchos con la relación impresora–cartucho validada. */
  cartuchos: string[];
  /** Plantillas con la compatibilidad validada (de un cartucho validado para ella). */
  validadas: number[];
  /** Plantillas propuestas, sin validar. */
  propuestas: number[];
}

export function clasificar(c: Compatibilidades, asta: Set<number>): EstadoDemanda {
  if (c.validadas.some((t) => asta.has(t))) return 'CUBIERTA';
  if (c.propuestas.some((t) => asta.has(t))) return 'POR_VALIDAR';
  return c.cartuchos.length > 0 ? 'SIN_ASTA' : 'SIN_DATOS';
}

/** Los cartuchos de las impresoras SIN_ASTA, por las búsquedas que cubrirían. */
export function cartuchosQueFaltan(impresoras: ImpresoraDemandada[], marcaDe: Map<string, string>): CartuchoDemandado[] {
  const porCodigo = new Map<string, CartuchoDemandado>();
  for (const i of impresoras) {
    if (i.estado !== 'SIN_ASTA') continue;
    for (const codigo of i.cartuchos) {
      const c = porCodigo.get(codigo) ?? { codigo, marca: marcaDe.get(codigo) ?? '', busquedas: 0, impresoras: [] };
      c.busquedas += i.busquedas;
      c.impresoras.push(`${i.marca} ${i.nombre}`);
      porCodigo.set(codigo, c);
    }
  }
  return [...porCodigo.values()].sort((a, b) => b.busquedas - a.busquedas || a.codigo.localeCompare(b.codigo)).slice(0, TOPE_DEMANDA);
}

export async function demandaAsta(rango: RangoPedido, sede: SedeId | null): Promise<DemandaAsta> {
  const base: Prisma.RecommendationEventWhereInput = {
    createdAt: limitesDe(rango),
    ...(sede === null ? {} : { device: { odooCompanyId: sede } }),
  };

  const [porImpresora, tabletsPorImpresora, sinImpresora, asta] = await Promise.all([
    prisma.recommendationEvent.groupBy({
      by: ['matchedPrinterId'],
      where: { ...base, matchedPrinterId: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.recommendationEvent.groupBy({
      by: ['matchedPrinterId', 'deviceId'],
      where: { ...base, matchedPrinterId: { not: null }, deviceId: { not: null } },
    }),
    prisma.recommendationEvent.count({ where: { ...base, searchQuery: { not: '' }, resultsCount: 0 } }),
    plantillasAsta(),
  ]);

  const ids = porImpresora.map((g) => g.matchedPrinterId!);
  const [modelos, relaciones, productos] = await Promise.all([
    prisma.printerModel.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, brand: { select: { name: true } } } }),
    prisma.cartridgePrinterModel.findMany({
      where: { printerModelId: { in: ids }, status: 'VALIDADA' },
      select: { printerModelId: true, cartridgeId: true, cartridge: { select: { code: true, brand: { select: { name: true } } } } },
    }),
    // Los productos de los cartuchos de esas impresoras: validados y propuestos.
    prisma.productCartridge.findMany({
      where: { status: { in: ['VALIDADA', 'PROPUESTA'] }, cartridge: { printerModels: { some: { printerModelId: { in: ids }, status: 'VALIDADA' } } } },
      select: { odooProductTmplId: true, cartridgeId: true, status: true },
    }),
  ]);

  const modeloDe = new Map(modelos.map((m) => [m.id, m]));
  const marcaDe = new Map(relaciones.map((r) => [r.cartridge.code, r.cartridge.brand.name]));
  const productosDe = new Map<number, typeof productos>();
  for (const p of productos) productosDe.set(p.cartridgeId, [...(productosDe.get(p.cartridgeId) ?? []), p]);
  const compatDe = new Map<number, Compatibilidades>();
  for (const r of relaciones) {
    const c = compatDe.get(r.printerModelId) ?? { cartuchos: [], validadas: [], propuestas: [] };
    c.cartuchos.push(r.cartridge.code);
    for (const p of productosDe.get(r.cartridgeId) ?? []) (p.status === 'VALIDADA' ? c.validadas : c.propuestas).push(p.odooProductTmplId);
    compatDe.set(r.printerModelId, c);
  }
  const tablets = new Map<number, number>();
  for (const g of tabletsPorImpresora) tablets.set(g.matchedPrinterId!, (tablets.get(g.matchedPrinterId!) ?? 0) + 1);

  const totales = { conImpresora: 0, cubiertas: 0, porValidar: 0, sinAsta: 0, sinDatos: 0, sinImpresora };
  const clave = { CUBIERTA: 'cubiertas', POR_VALIDAR: 'porValidar', SIN_ASTA: 'sinAsta', SIN_DATOS: 'sinDatos' } as const;
  const todas: ImpresoraDemandada[] = [];
  for (const g of porImpresora) {
    const id = g.matchedPrinterId!;
    const m = modeloDe.get(id);
    if (!m) continue;
    const compat = compatDe.get(id) ?? { cartuchos: [], validadas: [], propuestas: [] };
    const estado = clasificar(compat, asta);
    totales.conImpresora += g._count._all;
    totales[clave[estado]] += g._count._all;
    if (estado === 'CUBIERTA') continue;
    todas.push({
      printerModelId: id,
      marca: m.brand.name,
      nombre: m.name,
      estado,
      busquedas: g._count._all,
      tablets: tablets.get(id) ?? 0,
      ultimaVez: (g._max.createdAt ?? new Date(0)).toISOString(),
      cartuchos: [...new Set(compat.cartuchos)].sort(),
    });
  }
  todas.sort((a, b) => b.busquedas - a.busquedas || b.ultimaVez.localeCompare(a.ultimaVez));

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    totales,
    impresoras: todas.slice(0, TOPE_DEMANDA),
    cartuchos: cartuchosQueFaltan(todas, marcaDe),
  };
}
