import type { Prisma } from '@prisma/client';
import type {
  CandidatoRevision,
  ErrorCode,
  EstadoRevision,
  ProductoEnRevision,
  RevisionDecision,
  RevisionQuery,
  RevisionRespuesta,
} from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { executeKw, searchRead } from '../../odoo/client.js';
import { CacheTtl } from '../../utils/cacheTtl.js';
import { normalizarCodigoCartucho } from './normalizar.js';

/**
 * Revisión de las propuestas producto → cartucho (#56, Fase 3).
 *
 * ── Qué se ordena primero ────────────────────────────────────────────────────
 *
 * Lo que más se vende. Los 20 consumibles más vendidos son el 39 % del importe
 * de consumibles de 12 meses (#56), y es sobre ese top 20 donde se mide la
 * cobertura que decide si el kiosco sale. Revisar por orden alfabético gastaría
 * la primera tarde en productos que nadie compra.
 *
 * ── Lo que NUNCA hace ────────────────────────────────────────────────────────
 *
 * Borrar. Una fila rechazada es un dato —dice qué inferencia falla— y además
 * impide que el importador la vuelva a proponer. `asta_app` no tiene DELETE (#44).
 *
 * Pisar la decisión de otra persona. Cada fila viaja con el estado que se vio en
 * pantalla, y si ya no es ese, no se toca ninguna fila de la petición.
 */

const CATEGORIA_CONSUMIBLES = 2614;

/** Las ventas cambian despacio y la consulta recorre un año de líneas de pedido. */
const cacheVentas = new CacheTtl<Map<number, number>>(60 * 60_000, 1);
const cachePlantillas = new CacheTtl<{ nombre: string; sku: string | null; activo: boolean }>(10 * 60_000, 5_000);

/** Solo para tests. */
export function vaciarCachesRevision(): void {
  cacheVentas.vaciar();
  cachePlantillas.vaciar();
}

/** Importe vendido por plantilla de CONSUMIBLES en los últimos 12 meses. */
export async function ventasPorPlantilla(): Promise<Map<number, number>> {
  const enCache = cacheVentas.get('');
  if (enCache) return enCache;

  const hace12Meses = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // read_group no agrupa por plantilla: se agrupa por variante y se sube a su plantilla.
  const ventas = await executeKw<Array<{ product_id: [number, string] | false; price_subtotal: number }>>(
    'sale.order.line',
    'read_group',
    [
      [['state', 'in', ['sale', 'done']], ['product_id.categ_id', 'child_of', CATEGORIA_CONSUMIBLES], ['order_id.date_order', '>=', hace12Meses]],
      ['price_subtotal:sum'],
      ['product_id'],
    ],
    { lazy: false },
  );
  const conProducto = ventas.filter((v): v is { product_id: [number, string]; price_subtotal: number } => Boolean(v.product_id));
  const variantes = conProducto.length
    ? await searchRead<{ id: number; product_tmpl_id: [number, string] }>(
        'product.product',
        [['id', 'in', conProducto.map((v) => v.product_id[0])]],
        ['product_tmpl_id'],
        { context: { active_test: false } },
      )
    : [];
  const plantillaDe = new Map(variantes.map((v) => [v.id, v.product_tmpl_id[0]]));

  const importe = new Map<number, number>();
  for (const v of conProducto) {
    const t = plantillaDe.get(v.product_id[0]);
    if (t !== undefined) importe.set(t, (importe.get(t) ?? 0) + v.price_subtotal);
  }
  cacheVentas.set('', importe);
  return importe;
}

/** Nombre, referencia y si sigue a la venta, de cada plantilla. Las archivadas también. */
async function plantillas(ids: number[]): Promise<Map<number, { nombre: string; sku: string | null; activo: boolean }>> {
  const resultado = new Map<number, { nombre: string; sku: string | null; activo: boolean }>();
  const faltan: number[] = [];
  for (const id of ids) {
    const p = cachePlantillas.get(String(id));
    if (p) resultado.set(id, p);
    else faltan.push(id);
  }
  if (faltan.length) {
    const filas = await searchRead<{ id: number; name: string; default_code: string | false; active: boolean; sale_ok: boolean }>(
      'product.template',
      [['id', 'in', faltan]],
      ['name', 'default_code', 'active', 'sale_ok'],
      { context: { active_test: false } },
    );
    for (const f of filas) {
      const p = { nombre: f.name, sku: f.default_code || null, activo: f.active && f.sale_ok };
      cachePlantillas.set(String(f.id), p);
      resultado.set(f.id, p);
    }
  }
  return resultado;
}

export async function listarParaRevision(consulta: RevisionQuery): Promise<RevisionRespuesta> {
  const { estado, marca, q, pagina, porPagina } = consulta;

  // Productos con al menos un candidato en el estado pedido (y de la marca, si se filtra).
  const conEstado = await prisma.productCartridge.findMany({
    where: { status: estado, ...(marca ? { cartridge: { brand: { name: marca } } } : {}) },
    select: { odooProductTmplId: true },
    distinct: ['odooProductTmplId'],
  });
  let ids = conEstado.map((f) => f.odooProductTmplId);

  const [ventas, porEstadoFilas, marcas] = await Promise.all([
    ventasPorPlantilla(),
    prisma.productCartridge.groupBy({ by: ['status'], _count: true }),
    prisma.printerBrand.findMany({ where: { cartridges: { some: {} } }, select: { name: true }, orderBy: { name: 'asc' } }),
  ]);

  // La búsqueda mira el nombre y la referencia de Odoo, y el código del cartucho.
  let datosOdoo: Map<number, { nombre: string; sku: string | null; activo: boolean }> | undefined;
  if (q) {
    const texto = q.toLowerCase();
    datosOdoo = await plantillas(ids);
    const porCodigo = new Set(
      (
        await prisma.productCartridge.findMany({
          where: { odooProductTmplId: { in: ids }, cartridge: { codeNormalized: { contains: normalizarCodigoCartucho(q) } } },
          select: { odooProductTmplId: true },
        })
      ).map((f) => f.odooProductTmplId),
    );
    ids = ids.filter((id) => {
      const p = datosOdoo!.get(id);
      return porCodigo.has(id) || Boolean(p && (p.nombre.toLowerCase().includes(texto) || p.sku?.toLowerCase().includes(texto)));
    });
  }

  ids.sort((a, b) => (ventas.get(b) ?? 0) - (ventas.get(a) ?? 0) || a - b);
  const deLaPagina = ids.slice((pagina - 1) * porPagina, pagina * porPagina);

  const [filas, odoo] = await Promise.all([
    prisma.productCartridge.findMany({
      where: { odooProductTmplId: { in: deLaPagina } },
      select: {
        odooProductTmplId: true,
        cartridgeId: true,
        relation: true,
        source: true,
        evidence: true,
        status: true,
        reviewedAt: true,
        reviewer: { select: { email: true } },
        cartridge: { select: { code: true, kind: true, brand: { select: { name: true } } } },
      },
      orderBy: [{ cartridge: { code: 'asc' } }],
    }),
    plantillas(deLaPagina),
  ]);

  const candidatos = new Map<number, CandidatoRevision[]>();
  for (const f of filas) {
    const lista = candidatos.get(f.odooProductTmplId) ?? [];
    lista.push({
      cartridgeId: f.cartridgeId,
      marca: f.cartridge.brand.name,
      codigo: f.cartridge.code,
      tipo: f.cartridge.kind,
      relacion: f.relation,
      fuente: f.source,
      evidencia: f.evidence,
      estado: f.status,
      revisadoPor: f.reviewer?.email ?? null,
      revisadoEn: f.reviewedAt?.toISOString() ?? null,
    });
    candidatos.set(f.odooProductTmplId, lista);
  }

  const data: ProductoEnRevision[] = deLaPagina.map((id) => {
    const p = odoo.get(id);
    return {
      templateId: id,
      nombre: p?.nombre ?? null,
      sku: p?.sku ?? null,
      activoEnOdoo: p?.activo ?? false,
      ventas12m: Math.round((ventas.get(id) ?? 0) * 100) / 100,
      candidatos: candidatos.get(id) ?? [],
    };
  });

  const cuenta = (e: EstadoRevision) => porEstadoFilas.find((g) => g.status === e)?._count ?? 0;
  return {
    data,
    meta: {
      pagina,
      porPagina,
      totalProductos: ids.length,
      porEstado: { PROPUESTA: cuenta('PROPUESTA'), VALIDADA: cuenta('VALIDADA'), RECHAZADA: cuenta('RECHAZADA') },
      marcas: marcas.map((m) => m.name),
    },
  };
}

/**
 * Alguna fila ya no está en el estado que se vio en pantalla: otra persona la
 * revisó mientras tanto, o no existe. No se toca ninguna.
 */
export class RevisionDesactualizada extends Error {
  readonly status = 409;
  readonly code: ErrorCode = 'CONFLICT';

  constructor(readonly filas: Array<Record<string, number>>) {
    super('Alguien cambió estas compatibilidades mientras las mirabas. No se guardó nada: vuelve a decidir sobre lo que hay ahora.');
    this.name = 'RevisionDesactualizada';
  }
}

/** Corregir original/compatible con varias filas a la vez es un error de la interfaz, no una intención. */
export class RevisionInvalida extends Error {
  readonly status = 400;
  readonly code: ErrorCode = 'VALIDATION_ERROR';

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'RevisionInvalida';
  }
}

export async function aplicarRevision(decision: RevisionDecision, revisorId: string): Promise<{ actualizadas: number }> {
  if (decision.relacion && decision.filas.length > 1) {
    throw new RevisionInvalida('La relación original/compatible se corrige de una fila en una.');
  }
  const claves = new Set(decision.filas.map((f) => `${f.templateId}:${f.cartridgeId}`));
  if (claves.size !== decision.filas.length) throw new RevisionInvalida('Hay filas repetidas en la petición.');

  // Devolver a pendiente borra quién y cuándo: PROPUESTA significa "nadie lo ha
  // decidido". El historial queda en la auditoría.
  const pendiente = decision.decision === 'PROPUESTA';
  const datos: Prisma.ProductCartridgeUncheckedUpdateManyInput = {
    status: decision.decision,
    reviewedBy: pendiente ? null : revisorId,
    reviewedAt: pendiente ? null : new Date(),
    ...(decision.relacion ? { relation: decision.relacion } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const desactualizadas: Array<Record<string, number>> = [];
    for (const f of decision.filas) {
      const r = await tx.productCartridge.updateMany({
        where: { odooProductTmplId: f.templateId, cartridgeId: f.cartridgeId, status: f.estadoEsperado },
        data: datos,
      });
      if (r.count === 0) desactualizadas.push({ templateId: f.templateId, cartridgeId: f.cartridgeId });
    }
    // Lanzar dentro de la transacción la deshace entera.
    if (desactualizadas.length) throw new RevisionDesactualizada(desactualizadas);
    return { actualizadas: decision.filas.length };
  });
}

export class CartuchoNoEncontrado extends Error {
  readonly status = 404;
  readonly code: ErrorCode = 'NOT_FOUND';

  constructor(readonly cartridgeId: number) {
    super('Cartucho no encontrado.');
    this.name = 'CartuchoNoEncontrado';
  }
}

/**
 * El tipo es del CARTUCHO, no de la fila: corregirlo lo cambia en todos los
 * productos que lo usan. Es lo correcto —un CE278A es tóner lo venda quien lo
 * venda— y el importador no lo vuelve a tocar (#106).
 */
export async function corregirTipoCartucho(cartridgeId: number, tipo: 'TONER' | 'TINTA' | 'DRUM' | 'OTRO'): Promise<{ anterior: string }> {
  const actual = await prisma.cartridge.findUnique({ where: { id: cartridgeId }, select: { kind: true } });
  if (!actual) throw new CartuchoNoEncontrado(cartridgeId);
  await prisma.cartridge.update({ where: { id: cartridgeId }, data: { kind: tipo } });
  return { anterior: actual.kind };
}
