import type {
  LoteFabricante,
  CartuchoElegible,
  EstadoRevision,
  GuardarToners,
  ImpresoraConToners,
  PorImpresoraQuery,
  PorImpresoraRespuesta,
  VistaPorImpresora,
} from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { esAstaDeVerdad } from '../impulsa/equivalentesAsta.js';
import { normalizarCodigoCartucho, normalizarModelo } from './normalizar.js';
import { formasDelCodigo } from './separarModelos.js';
import { RevisionDesactualizada, RevisionInvalida, plantillasSiOdooResponde, ventasSiOdooResponde } from './revision.service.js';
import { ImpresoraNoEncontrada, invalidarCatalogoImpresoras } from './recomendador.service.js';

/**
 * La pestaña Impresoras, vista desde la impresora: «Impresora | Tóners compatibles».
 *
 * La revisión por cartucho (`revisionImpresoras.service.ts`) obligaba a encontrar
 * una impresora repartida entre sus cartuchos. Aquí cada impresora es una fila con
 * todo lo suyo, y se decide de una vez: se marcan los tóners que le sirven, se
 * busca o se crea el que falta, y se guarda.
 *
 * Mismas reglas de siempre: nada se borra (lo no marcado queda RECHAZADO, y lo
 * rechazado no se vuelve a proponer), lo que guarda un administrador queda
 * VALIDADO a su nombre, y si la base cambió mientras se miraba, 409 sin tocar nada.
 *
 * Cada tóner dice si tiene un producto ASTA validado, porque el kiosco solo
 * ofrece ASTA: un tóner compatible sin ASTA manda al cliente al mostrador.
 */

/** «CANON» → «Canon»; «HP» se queda. Igual que el importador. */
function nombreDeMarca(marca: string): string {
  const m = marca.trim();
  return m.length <= 2 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
}

function vistaDe(cuenta: Record<EstadoRevision, number>): Exclude<VistaPorImpresora, 'todas'> {
  if (cuenta.PROPUESTA > 0) return 'por_revisar';
  return cuenta.VALIDADA > 0 ? 'listas' : 'sin_toner';
}

/**
 * El producto ASTA validado de cada cartucho, si lo hay. `null` si Odoo no
 * respondió: sin el nombre del producto no se sabe si es ASTA.
 */
async function astaDe(cartridgeIds: number[]): Promise<Map<number, { nombre: string; sku: string | null }> | null> {
  const productos = cartridgeIds.length
    ? await prisma.productCartridge.findMany({
        where: { cartridgeId: { in: cartridgeIds }, status: 'VALIDADA' },
        select: { cartridgeId: true, odooProductTmplId: true },
      })
    : [];
  const plantillas = await plantillasSiOdooResponde([...new Set(productos.map((p) => p.odooProductTmplId))]);
  if (!plantillas) return null;
  const r = new Map<number, { nombre: string; sku: string | null }>();
  for (const p of productos) {
    const t = plantillas.get(p.odooProductTmplId);
    if (!t || !t.activo || r.has(p.cartridgeId)) continue;
    if (esAstaDeVerdad({ name: t.nombre, default_code: t.sku ?? false })) r.set(p.cartridgeId, { nombre: t.nombre, sku: t.sku });
  }
  return r;
}

/** Las impresoras pedidas con todos sus tóners, en el orden en que se piden. */
async function cargar(ids: number[], ventasDe: Map<number, number>): Promise<{ impresoras: ImpresoraConToners[]; odoo: boolean }> {
  const filas = await prisma.printerModel.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      inOdooCatalog: true,
      brand: { select: { name: true } },
      cartridges: {
        select: {
          status: true,
          source: true,
          sourceRef: true,
          reviewedAt: true,
          reviewer: { select: { email: true } },
          creator: { select: { email: true } },
          cartridge: { select: { id: true, code: true, kind: true, color: true, brand: { select: { name: true } } } },
        },
        orderBy: { cartridge: { code: 'asc' } },
      },
    },
  });
  const asta = await astaDe([...new Set(filas.flatMap((f) => f.cartridges.map((c) => c.cartridge.id)))]);
  const porId = new Map(filas.map((f) => [f.id, f]));

  const impresoras = ids
    .map((id) => porId.get(id))
    .filter((f) => f !== undefined)
    .map((f) => ({
      printerModelId: f.id,
      marca: f.brand.name,
      nombre: f.name,
      seVende: f.inOdooCatalog,
      ventas12m: Math.round((ventasDe.get(f.id) ?? 0) * 100) / 100,
      toners: f.cartridges.map((c) => ({
        cartridgeId: c.cartridge.id,
        marca: c.cartridge.brand.name,
        codigo: c.cartridge.code,
        tipo: c.cartridge.kind,
        color: c.cartridge.color,
        asta: asta?.get(c.cartridge.id) ?? null,
        estado: c.status,
        fuente: c.source,
        origen: c.sourceRef,
        propuestaPor: c.creator?.email ?? null,
        revisadoPor: c.reviewer?.email ?? null,
        revisadoEn: c.reviewedAt?.toISOString() ?? null,
      })),
    }));
  return { impresoras, odoo: asta !== null };
}

/** Ventas de 12 meses de cada impresora: la suma de los productos de sus tóners no rechazados. */
async function ventasPorImpresora(printerIds: number[]): Promise<{ ventas: Map<number, number>; odoo: boolean }> {
  const ventasOdoo = await ventasSiOdooResponde();
  const ventas = new Map<number, number>();
  if (!ventasOdoo || !printerIds.length) return { ventas, odoo: ventasOdoo !== null };

  const enlaces = await prisma.cartridgePrinterModel.findMany({
    where: { printerModelId: { in: printerIds }, status: { not: 'RECHAZADA' } },
    select: { printerModelId: true, cartridgeId: true },
  });
  const productos = await prisma.productCartridge.findMany({
    where: { cartridgeId: { in: [...new Set(enlaces.map((e) => e.cartridgeId))] }, status: { not: 'RECHAZADA' } },
    select: { cartridgeId: true, odooProductTmplId: true },
  });
  const delCartucho = new Map<number, number>();
  for (const p of productos) delCartucho.set(p.cartridgeId, (delCartucho.get(p.cartridgeId) ?? 0) + (ventasOdoo.get(p.odooProductTmplId) ?? 0));
  for (const e of enlaces) ventas.set(e.printerModelId, (ventas.get(e.printerModelId) ?? 0) + (delCartucho.get(e.cartridgeId) ?? 0));
  return { ventas, odoo: true };
}

export async function listarPorImpresora(consulta: PorImpresoraQuery): Promise<PorImpresoraRespuesta> {
  const { vista, marca, q, pagina, porPagina } = consulta;
  const texto = q ? normalizarModelo(q) : '';

  // Por el código de un tóner también: «CF258A» trae las impresoras que lo usan.
  const conElToner = texto
    ? await prisma.cartridgePrinterModel.findMany({
        where: { cartridge: { codeNormalized: { contains: normalizarCodigoCartucho(q!) } } },
        select: { printerModelId: true },
        distinct: ['printerModelId'],
      })
    : [];

  const [impresoras, estados, marcas] = await Promise.all([
    prisma.printerModel.findMany({
      where: {
        isActive: true,
        ...(marca ? { brand: { name: marca } } : {}),
        ...(texto ? { OR: [{ nameNormalized: { contains: texto } }, { id: { in: conElToner.map((c) => c.printerModelId) } }] } : {}),
      },
      select: { id: true, name: true, inOdooCatalog: true, brand: { select: { name: true } } },
    }),
    prisma.cartridgePrinterModel.groupBy({ by: ['printerModelId', 'status'], where: { printerModel: { isActive: true } }, _count: true }),
    prisma.printerBrand.findMany({ where: { printerModels: { some: { isActive: true } } }, select: { name: true }, orderBy: { name: 'asc' } }),
  ]);

  const cuentaDe = new Map<number, Record<EstadoRevision, number>>();
  for (const g of estados) {
    const c = cuentaDe.get(g.printerModelId) ?? { PROPUESTA: 0, VALIDADA: 0, RECHAZADA: 0 };
    c[g.status] = g._count;
    cuentaDe.set(g.printerModelId, c);
  }
  const vacia = { PROPUESTA: 0, VALIDADA: 0, RECHAZADA: 0 };
  const porVista = { por_revisar: 0, sin_toner: 0, listas: 0, todas: impresoras.length };
  for (const i of impresoras) porVista[vistaDe(cuentaDe.get(i.id) ?? vacia)]++;

  const deLaVista = vista === 'todas' ? impresoras : impresoras.filter((i) => vistaDe(cuentaDe.get(i.id) ?? vacia) === vista);
  const { ventas, odoo: ventasOk } = await ventasPorImpresora(deLaVista.map((i) => i.id));

  // Lo que más se vende primero; luego lo que vendemos en tienda, que es lo que
  // el cliente compró aquí y vendrá a buscar.
  deLaVista.sort(
    (a, b) =>
      (ventas.get(b.id) ?? 0) - (ventas.get(a.id) ?? 0) ||
      Number(b.inOdooCatalog) - Number(a.inOdooCatalog) ||
      a.brand.name.localeCompare(b.brand.name) ||
      a.name.localeCompare(b.name, 'es', { numeric: true }),
  );
  const ids = deLaVista.slice((pagina - 1) * porPagina, pagina * porPagina).map((i) => i.id);
  const { impresoras: data, odoo: astaOk } = await cargar(ids, ventas);

  return {
    data,
    meta: {
      pagina,
      porPagina,
      total: deLaVista.length,
      porVista,
      odooDisponible: ventasOk && (ids.length === 0 || astaOk),
      marcas: marcas.map((m) => m.name),
    },
  };
}

/** Tóners que coinciden con lo tecleado, para el selector. Los que empiezan así, primero. */
export async function buscarCartuchos(q: string, limite = 12): Promise<CartuchoElegible[]> {
  const texto = normalizarCodigoCartucho(q);
  if (texto.length < 2) return [];
  const encontrados = await prisma.cartridge.findMany({
    where: { codeNormalized: { contains: texto } },
    select: { id: true, code: true, codeNormalized: true, kind: true, color: true, brand: { select: { name: true } } },
    take: 200,
  });
  encontrados.sort(
    (a, b) =>
      Number(b.codeNormalized.startsWith(texto)) - Number(a.codeNormalized.startsWith(texto)) ||
      a.codeNormalized.length - b.codeNormalized.length ||
      a.code.localeCompare(b.code),
  );
  const elegidos = encontrados.slice(0, limite);
  const asta = await astaDe(elegidos.map((c) => c.id));
  return elegidos.map((c) => ({ cartridgeId: c.id, marca: c.brand.name, codigo: c.code, tipo: c.kind, color: c.color, asta: asta?.get(c.id) ?? null }));
}

export interface TonersGuardados {
  impresora: ImpresoraConToners;
  validadas: number;
  rechazadas: number;
  cartuchosNuevos: number;
  /** Códigos, para la auditoría. */
  detalle: { validados: string[]; rechazados: string[]; creados: string[] };
}

/**
 * Deja una impresora con exactamente los tóners marcados como compatibles.
 *
 * Lo marcado queda VALIDADO; lo propuesto o validado que no se marcó, RECHAZADO;
 * lo rechazado que no se marcó sigue igual. Todo o nada.
 */
export async function guardarTonersDeImpresora(printerModelId: number, datos: GuardarToners, revisorId: string): Promise<TonersGuardados> {
  const r = await prisma.$transaction(async (tx) => {
    const impresora = await tx.printerModel.findFirst({ where: { id: printerModelId, isActive: true }, select: { id: true, brandId: true } });
    if (!impresora) throw new ImpresoraNoEncontrada(printerModelId);

    const actuales = await tx.cartridgePrinterModel.findMany({
      where: { printerModelId },
      select: { cartridgeId: true, status: true, cartridge: { select: { code: true } } },
    });
    const vistos = new Map(datos.vistos.map((v) => [v.cartridgeId, v.estado]));
    const cambiadas = actuales.filter((a) => vistos.get(a.cartridgeId) !== a.status).map((a) => a.cartridgeId);
    const desaparecidas = [...vistos.keys()].filter((id) => !actuales.some((a) => a.cartridgeId === id));
    if (cambiadas.length || desaparecidas.length) {
      throw new RevisionDesactualizada([...cambiadas, ...desaparecidas].map((cartridgeId) => ({ cartridgeId, printerModelId })));
    }

    const compatibles = new Set(datos.compatibles);
    const creados: string[] = [];
    let cartuchosNuevos = 0;
    for (const n of datos.nuevos) {
      const marca =
        (await tx.printerBrand.findFirst({ where: { name: n.marca.trim() } })) ?? (await tx.printerBrand.create({ data: { name: nombreDeMarca(n.marca) } }));
      const formas = formasDelCodigo(n.codigo, marca.name);
      if (!formas[0]) throw new RevisionInvalida(`«${n.codigo}» no es un código de tóner.`);
      const existentes = await tx.cartridge.findMany({ where: { brandId: marca.id, codeNormalized: { in: formas } } });
      let cartucho = formas.map((f) => existentes.find((c) => c.codeNormalized === f)).find(Boolean);
      if (!cartucho) {
        cartucho = await tx.cartridge.create({ data: { brandId: marca.id, code: n.codigo.trim(), codeNormalized: formas[0], kind: n.tipo } });
        cartuchosNuevos++;
      }
      compatibles.add(cartucho.id);
      creados.push(cartucho.code);
    }

    const existen = await tx.cartridge.findMany({ where: { id: { in: [...compatibles] } }, select: { id: true, code: true } });
    if (existen.length !== compatibles.size) throw new RevisionInvalida('Alguno de los tóners marcados ya no existe. Recarga la página.');
    const codigoDe = new Map([...existen.map((c) => [c.id, c.code] as const), ...actuales.map((a) => [a.cartridgeId, a.cartridge.code] as const)]);

    const ahora = new Date();
    const revisada = { reviewedBy: revisorId, reviewedAt: ahora };
    const validados: string[] = [];
    const rechazados: string[] = [];
    for (const id of compatibles) {
      const actual = actuales.find((a) => a.cartridgeId === id);
      if (actual?.status === 'VALIDADA') continue;
      if (actual) await tx.cartridgePrinterModel.update({ where: { cartridgeId_printerModelId: { cartridgeId: id, printerModelId } }, data: { status: 'VALIDADA', ...revisada } });
      else await tx.cartridgePrinterModel.create({ data: { cartridgeId: id, printerModelId, source: 'MANUAL', status: 'VALIDADA', createdBy: revisorId, ...revisada } });
      validados.push(codigoDe.get(id)!);
    }
    for (const a of actuales) {
      if (compatibles.has(a.cartridgeId) || a.status === 'RECHAZADA') continue;
      await tx.cartridgePrinterModel.update({ where: { cartridgeId_printerModelId: { cartridgeId: a.cartridgeId, printerModelId } }, data: { status: 'RECHAZADA', ...revisada } });
      rechazados.push(a.cartridge.code);
    }
    return { validados, rechazados, creados, cartuchosNuevos };
  });

  // Que el kiosco la enseñe —o deje de enseñarla— ya, y no dentro de cinco minutos.
  invalidarCatalogoImpresoras();
  const { ventas } = await ventasPorImpresora([printerModelId]);
  const { impresoras } = await cargar([printerModelId], ventas);
  return {
    impresora: impresoras[0]!,
    validadas: r.validados.length,
    rechazadas: r.rechazados.length,
    cartuchosNuevos: r.cartuchosNuevos,
    detalle: { validados: r.validados, rechazados: r.rechazados, creados: r.creados },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// En lote: lo que viene de las listas oficiales del fabricante
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pendiente de una lista oficial, en una impresora que el kiosco puede enseñar.
 * `brandId` acota a una marca: solo lo usan los tests, para no tocar lo de verdad.
 */
function delFabricante(brandId?: number) {
  return { source: 'FABRICANTE', status: 'PROPUESTA', printerModel: { isActive: true, ...(brandId ? { brandId } : {}) } } as const;
}

/** Cuánto hay pendiente de las listas oficiales, y de dónde sale. */
export async function resumenLoteFabricante(brandId?: number): Promise<LoteFabricante> {
  const filas = await prisma.cartridgePrinterModel.findMany({
    where: delFabricante(brandId),
    select: { cartridgeId: true, printerModelId: true, sourceRef: true },
  });
  return {
    propuestas: filas.length,
    impresoras: new Set(filas.map((f) => f.printerModelId)).size,
    cartuchos: new Set(filas.map((f) => f.cartridgeId)).size,
    fuentes: [...new Set(filas.map((f) => f.sourceRef).filter((x): x is string => Boolean(x)))].sort(),
  };
}

/**
 * Valida de una vez lo pendiente de las listas oficiales.
 *
 * `esperadas` es lo que la persona vio antes de confirmar. Si la base ya no
 * dice lo mismo, no se valida nada: lo que se aprobó fue esa cifra, no otra.
 * Lo rechazado no se toca, y lo de otras fuentes (el nombre del producto, un
 * vendedor) sigue pasando por revisión una a una.
 */
export async function validarLoteFabricante(esperadas: number, revisorId: string, brandId?: number): Promise<{ validadas: number }> {
  const r = await prisma.$transaction(async (tx) => {
    const ahora = await tx.cartridgePrinterModel.count({ where: delFabricante(brandId) });
    if (ahora !== esperadas) throw new RevisionDesactualizada([{ esperadas, ahora }]);
    const { count } = await tx.cartridgePrinterModel.updateMany({
      where: delFabricante(brandId),
      data: { status: 'VALIDADA', reviewedBy: revisorId, reviewedAt: new Date() },
    });
    return { validadas: count };
  });
  invalidarCatalogoImpresoras();
  return r;
}
