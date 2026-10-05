import type { CompatibilityStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { claveDelCatalogo, esLaDelCatalogo, esLaMisma } from './impresoraExistente.js';

/**
 * Une las impresoras que entraron dos veces con dos nombres (#173).
 *
 * `buscarImpresora` evita que se creen duplicados desde #173, pero no arregla los
 * que ya estaban: en producción el catálogo y los tóners se importaron antes del
 * arreglo, y quedaron 25 pares como «L1110» y «EcoTank L1110», «MF741» e
 * «imageCLASS MF741». El kiosco enseña las dos: una con su tóner y otra que
 * manda al mostrador, y el revisor tiene que validar lo mismo dos veces.
 *
 * ── Qué se considera la misma ────────────────────────────────────────────────
 *
 * La regla de `buscarImpresora`, ni más ni menos: un nombre acaba en el otro
 * (`esLaMisma`) o es la impresora del catálogo por la clave de su modelo
 * (`esLaDelCatalogo`). Solo entre impresoras ACTIVAS de la misma marca: una
 * desactivada la retiró alguien, o ya está unida.
 *
 * Si tres o más quedan enlazadas, todas tienen que ser la misma de dos en dos.
 * «M132» acaba en las dos, pero si «LaserJet M132» y «MFP M132» no son la misma
 * entre ellas, el grupo no se toca: se avisa y se decide a mano. Unir dos
 * impresoras distintas es peor que dejar una duplicada.
 *
 * ── Qué hace con cada grupo ──────────────────────────────────────────────────
 *
 * Se queda la del nombre más largo, que es el que dice la familia: «EcoTank
 * L1110» mejor que «L1110». Las demás:
 *
 *   · sus tóners pasan a la que se queda. Si la que se queda ya tenía ese tóner,
 *     la fila de la otra se queda donde está, con la impresora desactivada:
 *     aquí no se borran filas, y el usuario de la aplicación ni siquiera tiene
 *     DELETE sobre `cartridge_printer_models`. No estorba: el panel, la
 *     cobertura y el kiosco solo miran impresoras activas. Antes, si la otra ya
 *     estaba revisada y esta no, la que se queda hereda la revisión. Dos
 *     revisiones distintas del mismo tóner son un conflicto, y el grupo no se
 *     toca;
 *   · sus alias pasan a la que se queda, y su nombre se añade como alias: el
 *     cliente que teclea «L1110» la sigue encontrando, y los importadores la
 *     reconocen por él (ver `buscarImpresora`);
 *   · se desactivan, no se borran. Lo que se enseñó en el kiosco
 *     (`recommendation_events`) sigue apuntando a ella: es historia.
 *
 * Si alguna era del catálogo de Odoo, la que se queda pasa a serlo.
 *
 * Como los importadores: sin `aplicar` hace todo dentro de una transacción que se
 * deshace, y repetirlo no cambia nada.
 */

export interface ImpresoraParaUnir {
  id: number;
  brandId: number;
  marca: string;
  name: string;
  nameNormalized: string;
  inOdooCatalog: boolean;
}

/** ¿Son la misma, con las mismas reglas con que `buscarImpresora` evita crearlas? */
export function sonLaMisma(a: ImpresoraParaUnir, b: ImpresoraParaUnir): boolean {
  if (a.brandId !== b.brandId || a.id === b.id) return false;
  if (esLaMisma(a.nameNormalized, b.nameNormalized)) return true;
  const delCatalogo = (de: ImpresoraParaUnir, otra: ImpresoraParaUnir) => {
    if (!de.inOdooCatalog) return false;
    const clave = claveDelCatalogo(de.marca, de.name);
    return clave !== null && esLaDelCatalogo(otra.nameNormalized, clave);
  };
  return delCatalogo(a, b) || delCatalogo(b, a);
}

/** La que se queda: el nombre más largo; a igualdad, la del catálogo; luego la más antigua. */
export function laQueSeQueda<T extends ImpresoraParaUnir>(grupo: T[]): T {
  return [...grupo].sort(
    (a, b) => b.name.length - a.name.length || Number(b.inOdooCatalog) - Number(a.inOdooCatalog) || a.id - b.id,
  )[0]!;
}

export interface Grupos<T extends ImpresoraParaUnir> {
  /** Cada grupo, con la que se queda primero. */
  unir: Array<{ queda: T; sobran: T[] }>;
  /** Enlazadas de tres o más que no son todas la misma entre ellas. */
  dudosos: T[][];
}

export function agruparDuplicadas<T extends ImpresoraParaUnir>(impresoras: T[]): Grupos<T> {
  const padre = new Map(impresoras.map((i) => [i.id, i.id]));
  const raiz = (id: number): number => {
    const p = padre.get(id)!;
    if (p === id) return id;
    const r = raiz(p);
    padre.set(id, r);
    return r;
  };
  const agrupar = <K>(clave: (i: T) => K) => {
    const m = new Map<K, T[]>();
    for (const i of impresoras) m.set(clave(i), [...(m.get(clave(i)) ?? []), i]);
    return [...m.values()];
  };
  for (const deLaMarca of agrupar((i) => i.brandId)) {
    for (let i = 0; i < deLaMarca.length; i++) {
      for (let j = i + 1; j < deLaMarca.length; j++) {
        if (sonLaMisma(deLaMarca[i]!, deLaMarca[j]!)) padre.set(raiz(deLaMarca[i]!.id), raiz(deLaMarca[j]!.id));
      }
    }
  }

  const grupos = agrupar((i) => raiz(i.id)).filter((g) => g.length > 1);
  const r: Grupos<T> = { unir: [], dudosos: [] };
  for (const g of grupos) {
    const todasLaMisma = g.every((a, i) => g.slice(i + 1).every((b) => sonLaMisma(a, b)));
    if (!todasLaMisma) {
      r.dudosos.push(g);
      continue;
    }
    const queda = laQueSeQueda(g);
    r.unir.push({ queda, sobran: g.filter((i) => i.id !== queda.id) });
  }
  return r;
}

export interface GrupoUnido {
  marca: string;
  queda: string;
  sobran: string[];
  tonersMovidos: number;
  /** Tóners que la que se queda ya tenía: la fila de la otra se queda con ella, desactivada. */
  tonersRepetidos: number;
  alias: number;
}

export interface ResumenUnion {
  impresoras: number;
  grupos: GrupoUnido[];
  dudosos: string[][];
  /** Dos revisiones distintas del mismo tóner: el grupo no se toca. */
  conflictos: Array<{ marca: string; impresoras: string[]; cartucho: string }>;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenUnion) {
    super('simulacro');
  }
}

const REVISADA = (s: CompatibilityStatus) => s !== 'PROPUESTA';

/** `donde` acota las impresoras que se miran; solo lo usan los tests, para no tocar las de verdad. */
export async function unirEn(tx: Prisma.TransactionClient, donde: Prisma.PrinterModelWhereInput = {}): Promise<ResumenUnion> {
  const activas = await tx.printerModel.findMany({
    where: { ...donde, isActive: true },
    select: { id: true, brandId: true, name: true, nameNormalized: true, inOdooCatalog: true, brand: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  const impresoras = activas.map(({ brand, ...i }) => ({ ...i, marca: brand.name }));
  const { unir: grupos, dudosos } = agruparDuplicadas(impresoras);
  const r: ResumenUnion = { impresoras: impresoras.length, grupos: [], dudosos: dudosos.map((g) => g.map((i) => i.name)), conflictos: [] };

  for (const { queda, sobran } of grupos) {
    const ids = [queda.id, ...sobran.map((s) => s.id)];
    const filas = await tx.cartridgePrinterModel.findMany({
      where: { printerModelId: { in: ids } },
      include: { cartridge: { select: { code: true } } },
    });
    /** Qué tóners tiene ya la que se queda, y en qué estado. */
    const deLaQueQueda = new Map(filas.filter((f) => f.printerModelId === queda.id).map((f) => [f.cartridgeId, f.status]));

    // Primero, ¿hay conflicto? Sin escribir nada: el grupo se une entero o no se toca.
    const conflicto = filas.find((f) =>
      REVISADA(f.status) && filas.some((o) => o.cartridgeId === f.cartridgeId && REVISADA(o.status) && o.status !== f.status),
    );
    if (conflicto) {
      r.conflictos.push({ marca: queda.marca, impresoras: [queda.name, ...sobran.map((s) => s.name)], cartucho: conflicto.cartridge.code });
      continue;
    }

    const g: GrupoUnido = { marca: queda.marca, queda: queda.name, sobran: sobran.map((s) => s.name), tonersMovidos: 0, tonersRepetidos: 0, alias: 0 };
    for (const f of filas) {
      if (f.printerModelId === queda.id) continue;
      const ya = deLaQueQueda.get(f.cartridgeId);
      if (ya === undefined) {
        await tx.cartridgePrinterModel.update({
          where: { cartridgeId_printerModelId: { cartridgeId: f.cartridgeId, printerModelId: f.printerModelId } },
          data: { printerModelId: queda.id },
        });
        deLaQueQueda.set(f.cartridgeId, f.status);
        g.tonersMovidos++;
        continue;
      }
      if (REVISADA(f.status) && !REVISADA(ya)) {
        await tx.cartridgePrinterModel.update({
          where: { cartridgeId_printerModelId: { cartridgeId: f.cartridgeId, printerModelId: queda.id } },
          data: { status: f.status, reviewedBy: f.reviewedBy, reviewedAt: f.reviewedAt },
        });
        deLaQueQueda.set(f.cartridgeId, f.status);
      }
      g.tonersRepetidos++;
    }

    const aliasQueda = new Set(
      (await tx.printerModelAlias.findMany({ where: { printerModelId: queda.id }, select: { aliasNormalized: true } })).map((a) => a.aliasNormalized),
    );
    for (const s of sobran) {
      // Los alias que choquen con uno de la que se queda se quedan donde estaban: ya están.
      for (const a of await tx.printerModelAlias.findMany({ where: { printerModelId: s.id } })) {
        if (aliasQueda.has(a.aliasNormalized)) continue;
        await tx.printerModelAlias.update({ where: { id: a.id }, data: { printerModelId: queda.id } });
        aliasQueda.add(a.aliasNormalized);
        g.alias++;
      }
      if (!aliasQueda.has(s.nameNormalized)) {
        await tx.printerModelAlias.create({ data: { printerModelId: queda.id, alias: s.name, aliasNormalized: s.nameNormalized, source: 'MANUAL' } });
        aliasQueda.add(s.nameNormalized);
        g.alias++;
      }
      await tx.printerModel.update({ where: { id: s.id }, data: { isActive: false } });
    }
    if (!queda.inOdooCatalog && sobran.some((s) => s.inOdooCatalog)) {
      await tx.printerModel.update({ where: { id: queda.id }, data: { inOdooCatalog: true } });
    }
    r.grupos.push(g);
  }
  return r;
}

export async function unirImpresorasDuplicadas(opciones: { aplicar: boolean }): Promise<ResumenUnion> {
  if (opciones.aplicar) return prisma.$transaction((tx) => unirEn(tx), { timeout: 120_000 });
  try {
    await prisma.$transaction(
      async (tx) => {
        throw new Simulacro(await unirEn(tx));
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof Simulacro) return error.resumen;
    throw error;
  }
  throw new Error('inalcanzable: el simulacro siempre deshace');
}
