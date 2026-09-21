import type { CartridgeKind, ProductRelation } from '@prisma/client';
import type { ErrorCode, PublicCompatibleItem, PublicPrinter } from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { searchRead, type OdooDomain } from '../../odoo/client.js';
import { CacheTtl } from '../../utils/cacheTtl.js';
import { estadoDeStock, TTL_CACHE_INVENTARIO_MS, umbralStockBajo, type AlmacenCliente } from '../inventory.service.js';
import { buscarModelos, type ModeloBuscable } from './buscarModelos.js';

/**
 * Endpoints del recomendador (#39): de "qué impresora tienes" a "qué tóner le
 * sirve y si lo hay".
 *
 * ── Qué se sirve ─────────────────────────────────────────────────────────────
 *
 * Solo lo VALIDADO por una persona, en los DOS tramos: `cartridge_printer_models`
 * (esta impresora usa este cartucho) y `product_cartridges` (este producto es o
 * sustituye a ese cartucho). El importador de #56 deja 1117 propuestas; si una
 * sola llegara al cliente, el kiosco le vendería delante de él un tóner que no
 * le sirve. Tampoco se sirven impresoras ni alias desactivados.
 *
 * ── Qué existencia ─────────────────────────────────────────────────────────────
 *
 * La misma que `/inventory`, y por el mismo camino: `free_qty` en el almacén que
 * vende al cliente del token. Un producto no puede estar "disponible" en un
 * endpoint y "agotado" en el otro.
 *
 * ── Qué NUNCA sale de aquí ───────────────────────────────────────────────────
 *
 * Precios ni costos: la tarifa del cliente es #31. Ni el estado de revisión, el
 * revisor o la evidencia: son datos internos de la captura.
 */

/** Campos que se leen de Odoo. Cerrada a propósito, como en `inventory.service.ts`. */
const CAMPOS = ['default_code', 'name', 'product_tmpl_id', 'free_qty'] as const;

interface FilaProducto {
  id: number;
  default_code: string | false;
  name: string;
  product_tmpl_id: [number, string];
  free_qty: number;
}

/**
 * El catálogo de impresoras cambia cuando alguien valida un modelo o un alias, no
 * a cada búsqueda. 5 minutos evita leer miles de filas por tecla en el kiosco.
 */
export const TTL_CATALOGO_IMPRESORAS_MS = 5 * 60_000;
const cacheCatalogo = new CacheTtl<ModeloBuscable[]>(TTL_CATALOGO_IMPRESORAS_MS, 1);
/** El mismo TTL que el inventario: la guía promete "hasta 60 s" para las existencias. */
const cacheCompatibles = new CacheTtl<{ impresora: PublicPrinter; items: PublicCompatibleItem[]; sinCompatibilidadesCargadas: boolean }>(
  TTL_CACHE_INVENTARIO_MS,
  2_000,
);

/** Solo para tests. */
export function vaciarCachesRecomendador(): void {
  cacheCatalogo.vaciar();
  cacheCompatibles.vaciar();
}

/**
 * La impresora no existe, está desactivada o todavía no tiene ningún cartucho
 * validado. La misma respuesta para los tres: una impresora retirada lo está
 * porque su ficha era un error, y una sin revisar puede serlo.
 *
 * Se lanza para que el status lo ponga `errorHandler`. Ver `InventarioNoDisponible`.
 */
export class ImpresoraNoEncontrada extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'PRINTER_NOT_FOUND';

  constructor(readonly printerId: number) {
    super('Impresora no encontrada.');
    this.name = 'ImpresoraNoEncontrada';
  }
}

/**
 * Qué impresoras existen PARA EL CLIENTE: activas y con al menos un cartucho
 * VALIDADO.
 *
 * Sin la segunda condición, el catálogo público era toda la tabla
 * `printer_models`, y a esa tabla se llega sin revisión (revisión de #111/#112):
 *
 *   · el importador de `compatibilidad_productos` crea sus 309 modelos desde
 *     texto libre, con las erratas que el propio importador reconoce («P560» por
 *     «P1560»), activos;
 *   · un VENDEDOR que propone una compatibilidad crea la impresora, activa, con el
 *     nombre que escriba. Comprobado: «Visita www.ejemplo-falso.com 4455» salía
 *     en el buscador de cualquier cliente al instante.
 *
 * La compatibilidad nace PROPUESTA, pero la impresora ya era pública. Se aplica
 * en los DOS caminos —búsqueda y `/compatible` por id— porque los ids son
 * consecutivos: sin filtrar el segundo, recorrer ids leía los mismos nombres.
 */
const IMPRESORA_PUBLICABLE = { isActive: true, cartridges: { some: { status: 'VALIDADA' as const } } };

async function catalogoDeImpresoras(): Promise<ModeloBuscable[]> {
  const enCache = cacheCatalogo.get('');
  if (enCache) return enCache;

  const modelos = await prisma.printerModel.findMany({
    where: IMPRESORA_PUBLICABLE,
    select: {
      id: true,
      name: true,
      brand: { select: { name: true } },
      aliases: { where: { isActive: true }, select: { alias: true } },
    },
  });
  const catalogo = modelos.map((m) => ({ id: m.id, nombre: m.name, marca: m.brand.name, aliases: m.aliases.map((a) => a.alias) }));
  cacheCatalogo.set('', catalogo);
  return catalogo;
}

export async function buscarImpresoras(q: string, limit: number): Promise<{ impresoras: PublicPrinter[]; sugerencias: PublicPrinter[] }> {
  const { coincidencias, sugerencias } = buscarModelos(q, await catalogoDeImpresoras());
  // Construidas campo a campo: la puntuación es interna.
  const aPublica = (c: { id: number; marca: string; nombre: string }): PublicPrinter => ({ id: c.id, marca: c.marca, nombre: c.nombre });
  return { impresoras: coincidencias.slice(0, limit).map(aPublica), sugerencias: sugerencias.slice(0, limit).map(aPublica) };
}

const TIPO_CARTUCHO: Record<CartridgeKind, PublicCompatibleItem['cartuchos'][number]['tipo']> = {
  TONER: 'toner',
  TINTA: 'tinta',
  DRUM: 'tambor',
  OTRO: 'otro',
};

const ORDEN_STOCK = { disponible: 0, bajo: 1, agotado: 2 } as const;

export function dominioCompatibles(templateIds: number[], companyId: number, soloDisponibles: boolean): OdooDomain {
  // Las mismas tres condiciones que `dominioInventario`: lo que no se ve en
  // `/inventory` tampoco se recomienda.
  const dominio: OdooDomain = [
    ['product_tmpl_id', 'in', templateIds],
    ['sale_ok', '=', true],
    ['detailed_type', '=', 'product'],
    ['company_id', 'in', [false, companyId]],
  ];
  if (soloDisponibles) dominio.push(['free_qty', '>', 0]);
  return dominio;
}

export interface Compatibles {
  impresora: PublicPrinter;
  items: PublicCompatibleItem[];
  sinCompatibilidadesCargadas: boolean;
  desdeCache: boolean;
}

export async function compatiblesDe(printerId: number, almacen: AlmacenCliente, soloDisponibles: boolean): Promise<Compatibles> {
  const clave = JSON.stringify([almacen.companyId, almacen.warehouseId, umbralStockBajo(), printerId, soloDisponibles]);
  const enCache = cacheCompatibles.get(clave);
  if (enCache) return { ...enCache, desdeCache: true };

  const modelo = await prisma.printerModel.findFirst({
    where: { id: printerId, ...IMPRESORA_PUBLICABLE },
    select: { id: true, name: true, brand: { select: { name: true } } },
  });
  if (!modelo) throw new ImpresoraNoEncontrada(printerId);
  const impresora: PublicPrinter = { id: modelo.id, marca: modelo.brand.name, nombre: modelo.name };

  const filas = await prisma.productCartridge.findMany({
    where: {
      status: 'VALIDADA',
      cartridge: { printerModels: { some: { printerModelId: printerId, status: 'VALIDADA' } } },
    },
    select: {
      odooProductTmplId: true,
      relation: true,
      cartridge: { select: { code: true, kind: true, color: true, yieldPages: true, brand: { select: { name: true } } } },
    },
  });

  const porPlantilla = new Map<number, { relaciones: Set<ProductRelation>; cartuchos: PublicCompatibleItem['cartuchos'] }>();
  for (const f of filas) {
    const p = porPlantilla.get(f.odooProductTmplId) ?? { relaciones: new Set(), cartuchos: [] };
    p.relaciones.add(f.relation);
    p.cartuchos.push({
      marca: f.cartridge.brand.name,
      codigo: f.cartridge.code,
      tipo: TIPO_CARTUCHO[f.cartridge.kind],
      color: f.cartridge.color,
      rendimientoPaginas: f.cartridge.yieldPages,
    });
    porPlantilla.set(f.odooProductTmplId, p);
  }

  let items: PublicCompatibleItem[] = [];
  if (porPlantilla.size > 0) {
    const productos = await searchRead<FilaProducto>(
      'product.product',
      dominioCompatibles([...porPlantilla.keys()], almacen.companyId, soloDisponibles),
      [...CAMPOS],
      { order: 'default_code, id', context: { warehouse: almacen.warehouseId, allowed_company_ids: [almacen.companyId] } },
    );
    items = productos.map((fila) => {
      const p = porPlantilla.get(fila.product_tmpl_id[0])!;
      return {
        id: fila.id,
        templateId: fila.product_tmpl_id[0],
        sku: fila.default_code || null,
        nombre: fila.name,
        stock: estadoDeStock(fila.free_qty),
        // Ante la duda, compatible: ver `publicCompatibleItemSchema`.
        tipo: p.relaciones.has('COMPATIBLE') ? 'compatible' : 'original',
        cartuchos: [...p.cartuchos].sort((a, b) => a.codigo.localeCompare(b.codigo)),
      };
    });
    // `sort` es estable: dentro del mismo estado queda el orden de Odoo, por referencia.
    items.sort((a, b) => ORDEN_STOCK[a.stock] - ORDEN_STOCK[b.stock]);
  }

  const resultado = { impresora, items, sinCompatibilidadesCargadas: porPlantilla.size === 0 };
  cacheCompatibles.set(clave, resultado);
  return { ...resultado, desdeCache: false };
}
