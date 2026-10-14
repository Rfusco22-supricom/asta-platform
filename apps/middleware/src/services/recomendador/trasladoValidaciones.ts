import type { CartridgeKind, CompatibilitySource, CompatibilityStatus, Prisma, PrismaClient, ProductRelation } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { buscarImpresora } from './impresoraExistente.js';
import { normalizarModelo } from './normalizar.js';

/**
 * Lleva a otra base las compatibilidades ya REVISADAS (#56).
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 *
 * La revisión se hizo en una base de desarrollo, del 5 al 7 de octubre: cientos
 * de enlaces producto → cartucho y cartucho → impresora, validados o
 * rechazados uno a uno. Producción no tiene ninguno —ni siquiera se pasaron
 * allí los importadores—, así que el kiosco contesta «pregunta en el mostrador»
 * a todo. Repetir la revisión a mano son horas; repetirla mal es venderle a un
 * cliente un cartucho que no le sirve.
 *
 * ── Cómo viaja ───────────────────────────────────────────────────────────────
 *
 * Por claves que significan lo mismo en las dos bases, nunca por id:
 *
 *   · producto   → el id de la plantilla de Odoo, que es el MISMO Odoo
 *   · cartucho   → marca + código normalizado
 *   · impresora  → marca + nombre normalizado, buscada como la buscan los
 *                  importadores (`buscarImpresora`), para caer en la del
 *                  catálogo de Odoo si ya existe con otro nombre
 *
 * Lo que falta se crea —marca, cartucho, impresora y sus alias— porque una
 * decisión sin las filas que enlaza no se puede guardar.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * - No pisa una decisión distinta: si allí está VALIDADA y aquí RECHAZADA (o al
 *   revés), alguien la revisó en los dos sitios y no se elige por él. Se informa.
 * - No traslada propuestas: lo que nadie revisó no tiene nada que trasladar.
 * - No traslada los alias que salieron de búsquedas del kiosco de desarrollo,
 *   que son las pruebas de quien lo programaba, no lo que teclea un cliente.
 */

export interface CartuchoTraslado {
  marca: string;
  codigo: string;
  codigoNormalizado: string;
  tipo: CartridgeKind;
  color: string | null;
  paginas: number | null;
}

export interface ImpresoraTraslado {
  marca: string;
  nombre: string;
  alias: Array<{ alias: string; normalizado: string; fuente: CompatibilitySource }>;
}

interface Decision {
  estado: Extract<CompatibilityStatus, 'VALIDADA' | 'RECHAZADA'>;
  fuente: CompatibilitySource;
  revisada: string | null;
}

export interface ProductoCartuchoTraslado extends Decision {
  plantilla: number;
  /** `marca|codigoNormalizado`, la clave de `cartuchos`. */
  cartucho: string;
  relacion: ProductRelation;
  evidencia: string | null;
}

export interface CartuchoImpresoraTraslado extends Decision {
  cartucho: string;
  /** `marca|nombreNormalizado`, la clave de `impresoras`. */
  impresora: string;
  referencia: string | null;
}

export interface Traslado {
  /** Cuándo se exportó. Las decisiones son las de ese momento. */
  exportado: string;
  cartuchos: CartuchoTraslado[];
  impresoras: ImpresoraTraslado[];
  productoCartucho: ProductoCartuchoTraslado[];
  cartuchoImpresora: CartuchoImpresoraTraslado[];
}

const DECIDIDAS = { in: ['VALIDADA', 'RECHAZADA'] as CompatibilityStatus[] };

export const claveCartucho = (marca: string, codigoNormalizado: string) => `${marca}|${codigoNormalizado}`;
export const claveImpresora = (marca: string, nombre: string) => `${marca}|${normalizarModelo(nombre).slice(0, 120)}`;

/** Lo revisado en la base a la que apunta `DATABASE_URL`, listo para guardar en JSON. */
export async function exportarValidaciones(db: PrismaClient = prisma): Promise<Traslado> {
  const pc = await db.productCartridge.findMany({
    where: { status: DECIDIDAS },
    include: { cartridge: { include: { brand: true } } },
    orderBy: [{ odooProductTmplId: 'asc' }, { cartridgeId: 'asc' }],
  });
  const ci = await db.cartridgePrinterModel.findMany({
    where: { status: DECIDIDAS, printerModel: { isActive: true } },
    include: {
      cartridge: { include: { brand: true } },
      printerModel: { include: { brand: true, aliases: { where: { isActive: true, source: { not: 'BUSQUEDA' } } } } },
    },
    orderBy: [{ cartridgeId: 'asc' }, { printerModelId: 'asc' }],
  });

  const cartuchos = new Map<string, CartuchoTraslado>();
  for (const c of [...pc, ...ci].map((f) => f.cartridge)) {
    const clave = claveCartucho(c.brand.name, c.codeNormalized);
    if (!cartuchos.has(clave)) {
      cartuchos.set(clave, { marca: c.brand.name, codigo: c.code, codigoNormalizado: c.codeNormalized, tipo: c.kind, color: c.color, paginas: c.yieldPages });
    }
  }
  const impresoras = new Map<string, ImpresoraTraslado>();
  for (const { printerModel: m } of ci) {
    const clave = claveImpresora(m.brand.name, m.name);
    if (!impresoras.has(clave)) {
      impresoras.set(clave, {
        marca: m.brand.name,
        nombre: m.name,
        alias: m.aliases.map((a) => ({ alias: a.alias, normalizado: a.aliasNormalized, fuente: a.source })),
      });
    }
  }

  const fecha = (d: Date | null) => d?.toISOString() ?? null;
  return {
    exportado: new Date().toISOString(),
    cartuchos: [...cartuchos.values()],
    impresoras: [...impresoras.values()],
    productoCartucho: pc.map((f) => ({
      plantilla: f.odooProductTmplId,
      cartucho: claveCartucho(f.cartridge.brand.name, f.cartridge.codeNormalized),
      relacion: f.relation,
      evidencia: f.evidence,
      estado: f.status as Decision['estado'],
      fuente: f.source,
      revisada: fecha(f.reviewedAt),
    })),
    cartuchoImpresora: ci.map((f) => ({
      cartucho: claveCartucho(f.cartridge.brand.name, f.cartridge.codeNormalized),
      impresora: claveImpresora(f.printerModel.brand.name, f.printerModel.name),
      referencia: f.sourceRef,
      estado: f.status as Decision['estado'],
      fuente: f.source,
      revisada: fecha(f.reviewedAt),
    })),
  };
}

export interface Conflicto {
  que: 'producto→cartucho' | 'cartucho→impresora';
  enlace: string;
  aqui: CompatibilityStatus;
  traslado: CompatibilityStatus;
}

export interface ResumenTraslado {
  marcasCreadas: string[];
  cartuchosCreados: number;
  impresorasCreadas: number;
  /** Impresoras que ya estaban con otro nombre (la del catálogo de Odoo, casi siempre). */
  impresorasUnidas: Array<{ traslado: string; aqui: string }>;
  aliasCreados: number;
  /** Enlaces que no existían y se crean ya decididos. */
  creadas: number;
  /** Propuestas que pasan a la decisión trasladada. */
  decididas: number;
  /** Ya tenían esa misma decisión. */
  iguales: number;
  conflictos: Conflicto[];
  /** Enlaces cuyo cartucho o impresora no venía en el fichero: no debería pasar. */
  incompletos: number;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenTraslado) {
    super('simulacro');
  }
}

/** El traslado dentro de una transacción ya abierta. `aplicarTraslado` es la entrada normal. */
export async function trasladarEn(tx: Prisma.TransactionClient, t: Traslado, revisorId: string): Promise<ResumenTraslado> {
  const r: ResumenTraslado = {
    marcasCreadas: [],
    cartuchosCreados: 0,
    impresorasCreadas: 0,
    impresorasUnidas: [],
    aliasCreados: 0,
    creadas: 0,
    decididas: 0,
    iguales: 0,
    conflictos: [],
    incompletos: 0,
  };

  const marcas = new Map<string, number>();
  const marca = async (nombre: string) => {
    const guardada = marcas.get(nombre);
    if (guardada) return guardada;
    let fila = await tx.printerBrand.findFirst({ where: { name: nombre } });
    if (!fila) {
      fila = await tx.printerBrand.create({ data: { name: nombre } });
      r.marcasCreadas.push(nombre);
    }
    marcas.set(nombre, fila.id);
    return fila.id;
  };

  const cartuchos = new Map<string, number>();
  for (const c of t.cartuchos) {
    const brandId = await marca(c.marca);
    let fila = await tx.cartridge.findUnique({ where: { brandId_codeNormalized: { brandId, codeNormalized: c.codigoNormalizado } } });
    if (!fila) {
      fila = await tx.cartridge.create({
        data: { brandId, code: c.codigo, codeNormalized: c.codigoNormalizado, kind: c.tipo, color: c.color, yieldPages: c.paginas },
      });
      r.cartuchosCreados++;
    }
    cartuchos.set(claveCartucho(c.marca, c.codigoNormalizado), fila.id);
  }

  const impresoras = new Map<string, number>();
  for (const i of t.impresoras) {
    const brandId = await marca(i.marca);
    const nameNormalized = normalizarModelo(i.nombre).slice(0, 120);
    let fila = await buscarImpresora(tx, brandId, nameNormalized);
    if (!fila) {
      fila = await tx.printerModel.create({ data: { brandId, name: i.nombre.slice(0, 120), nameNormalized } });
      r.impresorasCreadas++;
    } else if (fila.nameNormalized !== nameNormalized) {
      r.impresorasUnidas.push({ traslado: `${i.marca} ${i.nombre}`, aqui: `${i.marca} ${fila.name}` });
    }
    if (i.alias.length) {
      const creados = await tx.printerModelAlias.createMany({
        data: i.alias.map((a) => ({ printerModelId: fila.id, alias: a.alias.slice(0, 120), aliasNormalized: a.normalizado.slice(0, 120), source: a.fuente })),
        skipDuplicates: true,
      });
      r.aliasCreados += creados.count;
    }
    impresoras.set(claveImpresora(i.marca, i.nombre), fila.id);
  }

  const revision = (d: Decision) => ({ status: d.estado, reviewedBy: revisorId, reviewedAt: d.revisada ? new Date(d.revisada) : new Date() });

  for (const d of t.productoCartucho) {
    const cartridgeId = cartuchos.get(d.cartucho);
    if (!cartridgeId) {
      r.incompletos++;
      continue;
    }
    const clave = { odooProductTmplId_cartridgeId: { odooProductTmplId: d.plantilla, cartridgeId } };
    const actual = await tx.productCartridge.findUnique({ where: clave });
    if (!actual) {
      await tx.productCartridge.create({
        data: { odooProductTmplId: d.plantilla, cartridgeId, relation: d.relacion, source: d.fuente, evidence: d.evidencia, ...revision(d) },
      });
      r.creadas++;
    } else if (actual.status === 'PROPUESTA') {
      await tx.productCartridge.update({ where: clave, data: revision(d) });
      r.decididas++;
    } else if (actual.status === d.estado) {
      r.iguales++;
    } else {
      r.conflictos.push({ que: 'producto→cartucho', enlace: `plantilla ${d.plantilla} → ${d.cartucho}`, aqui: actual.status, traslado: d.estado });
    }
  }

  for (const d of t.cartuchoImpresora) {
    const cartridgeId = cartuchos.get(d.cartucho);
    const printerModelId = impresoras.get(d.impresora);
    if (!cartridgeId || !printerModelId) {
      r.incompletos++;
      continue;
    }
    const clave = { cartridgeId_printerModelId: { cartridgeId, printerModelId } };
    const actual = await tx.cartridgePrinterModel.findUnique({ where: clave });
    if (!actual) {
      await tx.cartridgePrinterModel.create({
        data: { cartridgeId, printerModelId, source: d.fuente, sourceRef: d.referencia, ...revision(d) },
      });
      r.creadas++;
    } else if (actual.status === 'PROPUESTA') {
      await tx.cartridgePrinterModel.update({ where: clave, data: revision(d) });
      r.decididas++;
    } else if (actual.status === d.estado) {
      r.iguales++;
    } else {
      r.conflictos.push({ que: 'cartucho→impresora', enlace: `${d.cartucho} → ${d.impresora}`, aqui: actual.status, traslado: d.estado });
    }
  }

  return r;
}

/**
 * Aplica un traslado. Sin `aplicar` todo ocurre igual dentro de una transacción
 * que se deshace al final: el simulacro cuenta exactamente lo que se escribiría.
 */
export async function aplicarTraslado(t: Traslado, opciones: { aplicar: boolean; revisorId: string }): Promise<ResumenTraslado> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const r = await trasladarEn(tx, t, opciones.revisorId);
        if (!opciones.aplicar) throw new Simulacro(r);
        return r;
      },
      { timeout: 300_000 },
    );
  } catch (error) {
    if (error instanceof Simulacro) return error.resumen;
    throw error;
  }
}
