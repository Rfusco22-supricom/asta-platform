import type { ErrorCode, ParAstaClaro } from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { esAstaDeVerdad, esComponente } from '../impulsa/equivalentesAsta.js';
import { tipoDeCartucho } from './importarPropuestas.js';
import { RevisionDesactualizada, RevisionInvalida, plantillasSiOdooResponde } from './revision.service.js';
import { invalidarCatalogoImpresoras } from './recomendador.service.js';

/**
 * Los casos claros del tramo producto → cartucho, para validarlos de una vez.
 *
 * Hay dos tipos de lote, con sus reglas:
 *
 *   · ASTA (la de abajo): lo que el kiosco ofrece.
 *   · ORIGINAL: el cartucho del fabricante que vende Supricom, «CANON CARTUCHO
 *     DE TINTA PG-145 XL» → PG-145XL. No cambia lo que recomienda el kiosco (solo
 *     ofrece ASTA), pero son los productos que más se venden: sin ellos la
 *     cobertura del top no sube. Además de lo común, la MARCA del cartucho está
 *     en el nombre, no es un kit ni un combo («KIT MAXI … + PH-S»): eso no ES el
 *     cartucho, lo contiene. Y dos reglas propias, medidas sobre el top de ventas:
 *
 *       – El código puede estar en la REFERENCIA en vez de en el nombre. En un
 *         original la referencia es el número de pieza del fabricante: «CF258A»
 *         es ese tóner, y «T544120-AL» es la botella T544 de Epson (544 + color
 *         + región). Así entran «EPSON L1110, L3110, L3150, L5190 BLACK», que
 *         nombra las impresoras en vez del cartucho.
 *       – Si tiene varios candidatos pendientes, tienen que ser el MISMO cartucho
 *         con dos nombres: «HP TONER 105A» lleva 105A y W1105A, el número
 *         comercial y el de pieza. Se sabe que son el mismo porque la lista del
 *         fabricante da a uno las mismas impresoras que al otro, o una parte de
 *         ellas. Si no tienen impresoras de lista, o cada uno tiene alguna que
 *         el otro no, no es un caso claro.
 *
 * Común a los dos: el tipo que dice el nombre (tóner, tinta, tambor) es el del
 * cartucho. «CANON TONER GPR-53 MAGENTA» contra un GPR-53 dado de alta como
 * tambor no es un caso claro.
 *
 * El kiosco solo ofrece ASTA, y para recomendar un tóner necesita los dos tramos
 * validados. El de impresora → cartucho se valida en lote desde las listas
 * oficiales (#200); este es el otro. Un caso es CLARO cuando se cumple todo:
 *
 *   · el producto es ASTA de verdad (`esAstaDeVerdad`) y sigue a la venta;
 *   · no es una pieza suelta —polvo, chip— (`esComponente`): eso no sustituye al
 *     cartucho, y el kiosco ya lo pone al final;
 *   · la propuesta es COMPATIBLE (un ASTA nunca es el ORIGINAL de nadie);
 *   · el código EXACTO del cartucho está en el nombre, como palabra: «CF258A» en
 *     «ASTA TONER CF258A CON CHIP». Se permite un guion o un espacio entre
 *     caracteres («PG-145 XL» es PG145XL), pero no letras de más: «CE285A» no es
 *     «CE285», ni «285» es «CE285A».
 *
 * La persona ve la lista entera antes de validar, y el servidor vuelve a
 * calcularla al aplicar: por esta ruta no se puede validar nada que no sea un
 * caso claro, aunque alguien mande otra cosa.
 */

/** Sin Odoo no se sabe qué producto es ASTA: no se valida a ciegas. */
export class LoteSinOdoo extends Error {
  readonly status = 503;
  readonly code: ErrorCode = 'ODOO_UNAVAILABLE';
  constructor() {
    super('Odoo no responde: sin el nombre de los productos no se puede saber cuáles son ASTA. Prueba en un momento.');
    this.name = 'LoteSinOdoo';
  }
}

/**
 * ¿Está el código, entero y como palabra, en el nombre?
 *
 * Con `sufijoColor`, se admite el color pegado detrás: «GI-16Y» es GI-16 en
 * amarillo, «CRG-054BK» es el 054 negro. Solo BK, K, C, M e Y: «CF500A» no es
 * «CF500», ni «054H» (alto rendimiento) es el 054.
 */
export function nombreTraeCodigo(nombre: string, codigo: string, opciones: { sufijoColor?: boolean } = {}): boolean {
  const limpio = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (limpio.length < 3 || !/\d/.test(limpio)) return false;
  const patron = limpio
    .split('')
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s.\\-_/]?');
  const sufijo = opciones.sufijoColor ? '(?:BK|K|C|M|Y)?' : '';
  return new RegExp(`(?<![A-Z0-9])${patron}${sufijo}(?![A-Z0-9])`).test(nombre.toUpperCase());
}

export type TipoLote = 'ASTA' | 'ORIGINAL';

/**
 * ¿Es la referencia el número de pieza de este cartucho?
 *
 * Igual al código («CF258A», «W1105A»), o la pieza de Epson: el código de la
 * serie seguido de tres cifras (color y presentación) y quizá la región,
 * «T544120-AL» para el T544.
 */
export function referenciaEsCodigo(sku: string | null, codigo: string): boolean {
  if (!sku) return false;
  const ref = sku.toUpperCase().replace(/\s+/g, '');
  const cod = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cod.length < 4 || !/\d/.test(cod)) return false;
  if (ref.replace(/[^A-Z0-9]/g, '') === cod) return true;
  return /^T\d{2}[0-9A-Z]$/.test(cod) && new RegExp(`^${cod}\\d{3}(?:-[A-Z0-9]+)?$`).test(ref);
}

/** Las impresoras que la lista del fabricante da a cada cartucho. */
async function impresorasDeLista(cartuchos: number[]): Promise<Map<number, Set<number>>> {
  if (cartuchos.length === 0) return new Map();
  const filas = await prisma.cartridgePrinterModel.findMany({
    where: { cartridgeId: { in: cartuchos }, source: 'FABRICANTE', status: { not: 'RECHAZADA' } },
    select: { cartridgeId: true, printerModelId: true },
  });
  const por = new Map<number, Set<number>>();
  for (const f of filas) por.set(f.cartridgeId, (por.get(f.cartridgeId) ?? new Set()).add(f.printerModelId));
  return por;
}

/** ¿Están todas las impresoras de `a` en `b`? */
const contenida = (a: Set<number>, b: Set<number>) => [...a].every((x) => b.has(x));

/** Los casos claros pendientes de un tipo. `null` si Odoo no respondió: sin nombres no se sabe qué es ASTA. */
export async function paresClaros(tipo: TipoLote): Promise<ParAstaClaro[] | null> {
  const filas = await prisma.productCartridge.findMany({
    where: { status: 'PROPUESTA', relation: tipo === 'ASTA' ? 'COMPATIBLE' : 'ORIGINAL' },
    select: {
      odooProductTmplId: true,
      cartridgeId: true,
      cartridge: { select: { code: true, kind: true, brand: { select: { name: true } } } },
    },
  });
  if (filas.length === 0) return [];
  const plantillas = await plantillasSiOdooResponde([...new Set(filas.map((f) => f.odooProductTmplId))]);
  if (!plantillas) return null;

  // Candidatos pendientes por producto. Un ORIGINAL con varios solo es claro si
  // son el mismo cartucho: misma marca y mismas impresoras en la lista oficial.
  const candidatos = new Map<number, typeof filas>();
  for (const f of filas) candidatos.set(f.odooProductTmplId, [...(candidatos.get(f.odooProductTmplId) ?? []), f]);
  const conVarios = [...candidatos.values()].filter((c) => c.length > 1).flat();
  const lista = tipo === 'ORIGINAL' ? await impresorasDeLista([...new Set(conVarios.map((f) => f.cartridgeId))]) : new Map<number, Set<number>>();
  /*
   * El mismo cartucho con dos nombres: misma marca, y las impresoras de uno
   * dentro de las del otro. No hace falta que sean IGUALES: el 414A de la lista
   * trae las cinco impresoras de la serie y el W2023A (su magenta) solo la que se
   * leyó en la ficha de esa impresora. Dos cartuchos distintos no se contienen:
   * cada uno tiene impresoras que el otro no.
   */
  const unSoloCartucho = (templateId: number): boolean => {
    const c = candidatos.get(templateId) ?? [];
    if (c.length === 1) return true;
    if (new Set(c.map((f) => f.cartridge.brand.name)).size !== 1) return false;
    const conjuntos = c.map((f) => lista.get(f.cartridgeId) ?? new Set<number>());
    if (conjuntos.some((x) => x.size === 0)) return false;
    return conjuntos.every((a, i) => conjuntos.every((b, j) => i === j || contenida(a, b) || contenida(b, a)));
  };

  const claros: ParAstaClaro[] = [];
  for (const f of filas) {
    const p = plantillas.get(f.odooProductTmplId);
    if (!p || !p.activo || esComponente(p.nombre)) continue;
    // Un cartucho de tipo OTRO es uno del que no se sabe el tipo («057H» entró así): no contradice al nombre.
    if (f.cartridge.kind !== 'OTRO' && tipoDeCartucho(p.nombre) !== f.cartridge.kind) continue;
    const asta = esAstaDeVerdad({ name: p.nombre, default_code: p.sku ?? false });
    if (tipo === 'ASTA') {
      if (!asta || !nombreTraeCodigo(p.nombre, f.cartridge.code, { sufijoColor: true })) continue;
    } else {
      if (asta) continue;
      // El color pegado vale también aquí: «PFI-050BK» es el PFI-050 negro, como en el lote ASTA.
      if (!nombreTraeCodigo(p.nombre, f.cartridge.code, { sufijoColor: true }) && !referenciaEsCodigo(p.sku, f.cartridge.code)) continue;
      if (!new RegExp(`(?<![A-Z])${f.cartridge.brand.name.toUpperCase()}(?![A-Z])`).test(p.nombre.toUpperCase())) continue;
      if (!unSoloCartucho(f.odooProductTmplId) || /\bKIT\b|\+/i.test(p.nombre)) continue;
    }
    claros.push({ templateId: f.odooProductTmplId, nombre: p.nombre, sku: p.sku, cartridgeId: f.cartridgeId, marca: f.cartridge.brand.name, codigo: f.cartridge.code });
  }
  return claros.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }) || a.codigo.localeCompare(b.codigo));
}

/** Compatibilidad con la primera versión: el lote ASTA. */
export function paresAstaClaros(): Promise<ParAstaClaro[] | null> {
  return paresClaros('ASTA');
}

/**
 * Valida los pares pedidos, que tienen que ser casos claros pendientes AHORA.
 * Todo o nada: uno que ya no lo sea, y no se valida ninguno.
 */
export async function validarLoteAsta(
  pares: Array<{ templateId: number; cartridgeId: number }>,
  revisorId: string,
  tipo: TipoLote = 'ASTA',
): Promise<{ validadas: number }> {
  const claros = await paresClaros(tipo);
  if (claros === null) throw new LoteSinOdoo();
  const clave = (p: { templateId: number; cartridgeId: number }) => `${p.templateId}:${p.cartridgeId}`;
  const permitidos = new Set(claros.map(clave));
  const unicos = new Map(pares.map((p) => [clave(p), p]));
  const fuera = [...unicos.values()].filter((p) => !permitidos.has(clave(p)));
  if (fuera.length) {
    throw new RevisionInvalida(`${fuera.length} de los pares ya no son un caso claro pendiente. Recarga la lista.`);
  }

  const r = await prisma.$transaction(async (tx) => {
    const ahora = new Date();
    const perdidas: Array<Record<string, number>> = [];
    for (const p of unicos.values()) {
      const { count } = await tx.productCartridge.updateMany({
        where: { odooProductTmplId: p.templateId, cartridgeId: p.cartridgeId, status: 'PROPUESTA' },
        data: { status: 'VALIDADA', reviewedBy: revisorId, reviewedAt: ahora },
      });
      if (count === 0) perdidas.push({ templateId: p.templateId, cartridgeId: p.cartridgeId });
    }
    if (perdidas.length) throw new RevisionDesactualizada(perdidas);
    return { validadas: unicos.size };
  });
  invalidarCatalogoImpresoras();
  return r;
}
