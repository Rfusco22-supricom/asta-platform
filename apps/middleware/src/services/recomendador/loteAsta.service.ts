import type { ErrorCode, ParAstaClaro } from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { esAstaDeVerdad, esComponente } from '../impulsa/equivalentesAsta.js';
import { RevisionDesactualizada, RevisionInvalida, plantillasSiOdooResponde } from './revision.service.js';
import { invalidarCatalogoImpresoras } from './recomendador.service.js';

/**
 * Los casos claros del tramo producto → cartucho, para validarlos de una vez.
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

/** ¿Está el código, entero y como palabra, en el nombre? */
export function nombreTraeCodigo(nombre: string, codigo: string): boolean {
  const limpio = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (limpio.length < 3 || !/\d/.test(limpio)) return false;
  const patron = limpio
    .split('')
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s.\\-_/]?');
  return new RegExp(`(?<![A-Z0-9])${patron}(?![A-Z0-9])`).test(nombre.toUpperCase());
}

/** Los casos claros pendientes. `null` si Odoo no respondió: sin nombres no se sabe qué es ASTA. */
export async function paresAstaClaros(): Promise<ParAstaClaro[] | null> {
  const filas = await prisma.productCartridge.findMany({
    where: { status: 'PROPUESTA', relation: 'COMPATIBLE' },
    select: { odooProductTmplId: true, cartridgeId: true, cartridge: { select: { code: true, brand: { select: { name: true } } } } },
  });
  if (filas.length === 0) return [];
  const plantillas = await plantillasSiOdooResponde([...new Set(filas.map((f) => f.odooProductTmplId))]);
  if (!plantillas) return null;

  const claros: ParAstaClaro[] = [];
  for (const f of filas) {
    const p = plantillas.get(f.odooProductTmplId);
    if (!p || !p.activo) continue;
    if (!esAstaDeVerdad({ name: p.nombre, default_code: p.sku ?? false }) || esComponente(p.nombre)) continue;
    if (!nombreTraeCodigo(p.nombre, f.cartridge.code)) continue;
    claros.push({ templateId: f.odooProductTmplId, nombre: p.nombre, sku: p.sku, cartridgeId: f.cartridgeId, marca: f.cartridge.brand.name, codigo: f.cartridge.code });
  }
  return claros.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }) || a.codigo.localeCompare(b.codigo));
}

/**
 * Valida los pares pedidos, que tienen que ser casos claros pendientes AHORA.
 * Todo o nada: uno que ya no lo sea, y no se valida ninguno.
 */
export async function validarLoteAsta(pares: Array<{ templateId: number; cartridgeId: number }>, revisorId: string): Promise<{ validadas: number }> {
  const claros = await paresAstaClaros();
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
