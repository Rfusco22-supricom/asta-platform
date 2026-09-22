import type {
  CartuchoEnRevision,
  EstadoRevision,
  NuevaCompatibilidad,
  PropuestaPropia,
  RevisionImpresorasDecision,
  RevisionImpresorasRespuesta,
  RevisionQuery,
} from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { normalizarModelo } from './normalizar.js';
import { formasDelCodigo } from './separarModelos.js';
import { RevisionDesactualizada, RevisionInvalida, ventasPorPlantilla } from './revision.service.js';
import { ImpresoraNoEncontrada, invalidarCatalogoImpresoras } from './recomendador.service.js';

/**
 * El tramo impresora → cartucho: revisarlo y AÑADIR compatibilidades desde el
 * panel (#56).
 *
 * Mismas reglas que la revisión de productos (`revision.service.ts`): nada se
 * borra, cada decisión lleva el estado que se vio en pantalla, y ante un cambio
 * ajeno no se toca ninguna fila de la petición.
 *
 * ── Quién puede validar ──────────────────────────────────────────────────────
 *
 * Añadir lo pueden el administrador y el vendedor, pero NO con el mismo
 * resultado: lo del administrador nace VALIDADO y lo del vendedor PROPUESTO. Lo
 * decide quién llama —la ruta—, no la petición: `anadirCompatibilidad` recibe
 * `validar` de la ruta del administrador, y la del vendedor no tiene forma de
 * pasarlo.
 */

export async function listarImpresorasParaRevision(consulta: RevisionQuery): Promise<RevisionImpresorasRespuesta> {
  const { estado, marca, q, pagina, porPagina } = consulta;
  const texto = q ? normalizarModelo(q) : '';

  // Cartuchos con al menos una impresora en el estado pedido. La búsqueda mira el
  // código del cartucho y el nombre de sus impresoras.
  const conEstado = await prisma.cartridgePrinterModel.findMany({
    where: {
      status: estado,
      ...(marca ? { cartridge: { brand: { name: marca } } } : {}),
      ...(texto ? { OR: [{ cartridge: { codeNormalized: { contains: texto } } }, { printerModel: { nameNormalized: { contains: texto } } }] } : {}),
    },
    select: { cartridgeId: true },
    distinct: ['cartridgeId'],
  });
  const ids = conEstado.map((f) => f.cartridgeId);

  const [ventas, productos, porEstadoFilas, marcas, codigos] = await Promise.all([
    ventasPorPlantilla(),
    prisma.productCartridge.findMany({ where: { cartridgeId: { in: ids } }, select: { cartridgeId: true, odooProductTmplId: true, status: true } }),
    prisma.cartridgePrinterModel.groupBy({ by: ['status'], _count: true }),
    prisma.printerBrand.findMany({ where: { cartridges: { some: { printerModels: { some: {} } } } }, select: { name: true }, orderBy: { name: 'asc' } }),
    prisma.cartridge.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } }),
  ]);

  const ventasDe = new Map<number, number>();
  const validados = new Map<number, number>();
  const pendientes = new Map<number, number>();
  for (const p of productos) {
    ventasDe.set(p.cartridgeId, (ventasDe.get(p.cartridgeId) ?? 0) + (ventas.get(p.odooProductTmplId) ?? 0));
    if (p.status === 'VALIDADA') validados.set(p.cartridgeId, (validados.get(p.cartridgeId) ?? 0) + 1);
    if (p.status === 'PROPUESTA') pendientes.set(p.cartridgeId, (pendientes.get(p.cartridgeId) ?? 0) + 1);
  }
  const codigoDe = new Map(codigos.map((c) => [c.id, c.code]));

  // Lo que más se vende primero: es lo que más clientes van a buscar en el kiosco.
  ids.sort((a, b) => (ventasDe.get(b) ?? 0) - (ventasDe.get(a) ?? 0) || (codigoDe.get(a) ?? '').localeCompare(codigoDe.get(b) ?? ''));
  const deLaPagina = ids.slice((pagina - 1) * porPagina, pagina * porPagina);

  const cartuchos = await prisma.cartridge.findMany({
    where: { id: { in: deLaPagina } },
    select: {
      id: true,
      code: true,
      kind: true,
      color: true,
      yieldPages: true,
      brand: { select: { name: true } },
      printerModels: {
        select: {
          printerModelId: true,
          status: true,
          source: true,
          sourceRef: true,
          reviewedAt: true,
          reviewer: { select: { email: true } },
          creator: { select: { email: true } },
          printerModel: { select: { name: true, brand: { select: { name: true } } } },
        },
        orderBy: { printerModel: { name: 'asc' } },
      },
    },
  });
  const porId = new Map(cartuchos.map((c) => [c.id, c]));

  const data: CartuchoEnRevision[] = deLaPagina.map((id) => {
    const c = porId.get(id)!;
    return {
      cartridgeId: c.id,
      marca: c.brand.name,
      codigo: c.code,
      tipo: c.kind,
      color: c.color,
      rendimientoPaginas: c.yieldPages,
      productosValidados: validados.get(c.id) ?? 0,
      productosPendientes: pendientes.get(c.id) ?? 0,
      ventas12m: Math.round((ventasDe.get(c.id) ?? 0) * 100) / 100,
      impresoras: c.printerModels.map((p) => ({
        printerModelId: p.printerModelId,
        marca: p.printerModel.brand.name,
        nombre: p.printerModel.name,
        estado: p.status,
        fuente: p.source,
        origen: p.sourceRef,
        propuestaPor: p.creator?.email ?? null,
        revisadoPor: p.reviewer?.email ?? null,
        revisadoEn: p.reviewedAt?.toISOString() ?? null,
      })),
    };
  });

  const cuenta = (e: EstadoRevision) => porEstadoFilas.find((g) => g.status === e)?._count ?? 0;
  return {
    data,
    meta: {
      pagina,
      porPagina,
      totalCartuchos: ids.length,
      porEstado: { PROPUESTA: cuenta('PROPUESTA'), VALIDADA: cuenta('VALIDADA'), RECHAZADA: cuenta('RECHAZADA') },
      marcas: marcas.map((m) => m.name),
    },
  };
}

export async function aplicarRevisionImpresoras(decision: RevisionImpresorasDecision, revisorId: string): Promise<{ actualizadas: number }> {
  const claves = new Set(decision.filas.map((f) => `${f.cartridgeId}:${f.printerModelId}`));
  if (claves.size !== decision.filas.length) throw new RevisionInvalida('Hay filas repetidas en la petición.');
  const pendiente = decision.decision === 'PROPUESTA';

  return prisma.$transaction(async (tx) => {
    const desactualizadas: Array<Record<string, number>> = [];
    for (const f of decision.filas) {
      const r = await tx.cartridgePrinterModel.updateMany({
        where: { cartridgeId: f.cartridgeId, printerModelId: f.printerModelId, status: f.estadoEsperado },
        data: { status: decision.decision, reviewedBy: pendiente ? null : revisorId, reviewedAt: pendiente ? null : new Date() },
      });
      if (r.count === 0) desactualizadas.push({ cartridgeId: f.cartridgeId, printerModelId: f.printerModelId });
    }
    if (desactualizadas.length) throw new RevisionDesactualizada(desactualizadas);
    return { actualizadas: decision.filas.length };
  });
}

/** "CANON" → "Canon"; "HP" se queda. Igual que el importador. */
function nombreDeMarca(marca: string): string {
  const m = marca.trim();
  return m.length <= 2 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
}

export interface CompatibilidadAnadida {
  cartridgeId: number;
  printerModelId: number;
  estado: EstadoRevision;
  creada: boolean;
  impresoraNueva: boolean;
  cartuchoNuevo: boolean;
}

/**
 * «A esta impresora le sirve este cartucho», desde el panel.
 *
 * Crea la marca, la impresora y el cartucho si no existen. Si la compatibilidad
 * YA existía no se toca: un vendedor que la vuelve a proponer no puede devolver a
 * pendiente algo validado, ni reabrir algo rechazado.
 */
export async function anadirCompatibilidad(
  datos: NuevaCompatibilidad,
  quien: { autorId: string; validar: boolean },
): Promise<CompatibilidadAnadida> {
  return prisma.$transaction(async (tx) => {
    const marca = async (nombre: string) =>
      (await tx.printerBrand.findFirst({ where: { name: nombre.trim() } })) ?? (await tx.printerBrand.create({ data: { name: nombreDeMarca(nombre) } }));

    const marcaImpresora = await marca(datos.marcaImpresora);
    const marcaCartucho = datos.marcaCartucho ? await marca(datos.marcaCartucho) : marcaImpresora;

    // La marca delante del modelo sobra: "HP LaserJet Pro M404" en la marca HP es "LaserJet Pro M404".
    const nombreModelo = datos.modeloImpresora.replace(new RegExp(`^${marcaImpresora.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '').trim();
    const nameNormalized = normalizarModelo(nombreModelo).slice(0, 120);
    let impresoraNueva = false;
    let impresora = await tx.printerModel.findUnique({ where: { brandId_nameNormalized: { brandId: marcaImpresora.id, nameNormalized } } });
    if (!impresora) {
      impresora = await tx.printerModel.create({ data: { brandId: marcaImpresora.id, name: nombreModelo, nameNormalized } });
      impresoraNueva = true;
      invalidarCatalogoImpresoras();
    }

    const formas = formasDelCodigo(datos.codigoCartucho, marcaCartucho.name);
    const existentes = await tx.cartridge.findMany({ where: { brandId: marcaCartucho.id, codeNormalized: { in: formas } } });
    let cartuchoNuevo = false;
    let cartucho = formas.map((n) => existentes.find((c) => c.codeNormalized === n)).find(Boolean);
    if (!cartucho) {
      cartucho = await tx.cartridge.create({
        data: { brandId: marcaCartucho.id, code: datos.codigoCartucho.trim(), codeNormalized: formas[0], kind: datos.tipo },
      });
      cartuchoNuevo = true;
    }

    const clave = { cartridgeId_printerModelId: { cartridgeId: cartucho.id, printerModelId: impresora.id } };
    const ya = await tx.cartridgePrinterModel.findUnique({ where: clave, select: { status: true } });
    if (ya) {
      return { cartridgeId: cartucho.id, printerModelId: impresora.id, estado: ya.status, creada: false, impresoraNueva, cartuchoNuevo };
    }

    const estado: EstadoRevision = quien.validar ? 'VALIDADA' : 'PROPUESTA';
    await tx.cartridgePrinterModel.create({
      data: {
        cartridgeId: cartucho.id,
        printerModelId: impresora.id,
        source: 'MANUAL',
        status: estado,
        createdBy: quien.autorId,
        reviewedBy: quien.validar ? quien.autorId : null,
        reviewedAt: quien.validar ? new Date() : null,
      },
    });
    return { cartridgeId: cartucho.id, printerModelId: impresora.id, estado, creada: true, impresoraNueva, cartuchoNuevo };
  });
}

/** Las compatibilidades que propuso una persona, las más recientes primero. */
export async function propuestasDe(autorId: string): Promise<PropuestaPropia[]> {
  const filas = await prisma.cartridgePrinterModel.findMany({
    where: { createdBy: autorId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      cartridgeId: true,
      printerModelId: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      printerModel: { select: { name: true, brand: { select: { name: true } } } },
      cartridge: { select: { code: true, brand: { select: { name: true } } } },
    },
  });
  return filas.map((f) => ({
    cartridgeId: f.cartridgeId,
    printerModelId: f.printerModelId,
    marcaImpresora: f.printerModel.brand.name,
    modeloImpresora: f.printerModel.name,
    marcaCartucho: f.cartridge.brand.name,
    codigoCartucho: f.cartridge.code,
    estado: f.status,
    creadaEn: f.createdAt.toISOString(),
    revisadoEn: f.reviewedAt?.toISOString() ?? null,
  }));
}

/**
 * Atar una búsqueda sin resultado a una impresora, como alias (#43).
 *
 * La lista de búsquedas fallidas del panel ES la lista de alias que faltan: si
 * varios clientes teclean «hl2350» y nadie encuentra nada, lo que falta no es
 * producto, es ese alias. Al añadirlo, la misma búsqueda empieza a funcionar.
 *
 * `source = BUSQUEDA` a propósito: distingue lo que enseñó un cliente de lo que
 * escribió una persona del equipo, que es lo que el esquema (#101) quería poder
 * separar después.
 *
 * Un alias que ya existe NO se toca, ni siquiera para reactivarlo: si alguien lo
 * desactivó fue porque mandaba al cliente al tóner de otra impresora, y eso se
 * decide mirándolo, no volviéndolo a teclear.
 *
 * Quién lo añadió queda en la AUDITORÍA (`alias.anadido`), no en la tabla:
 * `printer_model_aliases` no tiene columna de autor y no hace falta una migración
 * para saberlo.
 */
export async function anadirAlias(
  datos: { printerModelId: number; alias: string },
): Promise<{ printerModelId: number; alias: string; creado: boolean; estabaDesactivado: boolean }> {
  const aliasNormalized = normalizarModelo(datos.alias).slice(0, 120);
  if (!aliasNormalized) throw new RevisionInvalida('Ese texto no deja nada que buscar.');

  const impresora = await prisma.printerModel.findFirst({ where: { id: datos.printerModelId, isActive: true }, select: { id: true } });
  if (!impresora) throw new ImpresoraNoEncontrada(datos.printerModelId);

  const ya = await prisma.printerModelAlias.findUnique({
    where: { printerModelId_aliasNormalized: { printerModelId: datos.printerModelId, aliasNormalized } },
    select: { isActive: true },
  });
  if (ya) return { printerModelId: datos.printerModelId, alias: datos.alias.trim(), creado: false, estabaDesactivado: !ya.isActive };

  await prisma.printerModelAlias.create({
    data: { printerModelId: datos.printerModelId, alias: datos.alias.trim().slice(0, 120), aliasNormalized, source: 'BUSQUEDA' },
  });
  // Para que la misma búsqueda funcione YA, y no dentro de cinco minutos.
  invalidarCatalogoImpresoras();
  return { printerModelId: datos.printerModelId, alias: datos.alias.trim(), creado: true, estabaDesactivado: false };
}
