import type { CartridgeKind, ProductRelation } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { extraerCartuchos, type CandidatoCartucho } from './extraerCartuchos.js';

/**
 * Carga de propuestas "producto → cartucho" en MySQL (#56, Fase 3; tablas de #101).
 *
 * Toma los consumibles de Odoo, pasa cada uno por `extraerCartuchos` y deja en
 * `product_cartridges` una fila `PROPUESTA` por candidato, creando antes las
 * marcas y cartuchos que falten. A partir de ahí, una persona las valida.
 *
 * ── Lo que NO hace nunca ─────────────────────────────────────────────────────
 *
 * **Tocar una fila que ya existe.** Es la regla que importa. El importador se va
 * a volver a ejecutar —cada vez que entren productos nuevos en Odoo— y para
 * entonces habrá filas VALIDADA y RECHAZADA. Si las pisara:
 *
 *   · una RECHAZADA volvería a PROPUESTA y el trabajo de revisión se perdería,
 *     o peor, alguien la validaría por error la segunda vez;
 *   · una VALIDADA perdería quién la validó y cuándo.
 *
 * Así que todo es "crear si no existe". Tampoco se corrige el `kind` o el color
 * de un cartucho existente: puede haberlo corregido una persona.
 *
 * **Borrar.** Ni puede —`asta_app` no tiene DELETE (#44)— ni debe: si el nombre
 * de un producto cambia en Odoo y deja de proponer un cartucho, la fila vieja se
 * queda, y es la revisión quien decide.
 */

export interface ProductoOdoo {
  id: number;
  name: string;
  default_code: string | false | null;
}

export interface ResumenImportacion {
  productos: number;
  sinCandidato: number;
  marcasCreadas: number;
  cartuchosCreados: number;
  propuestasCreadas: number;
  /** Ya existían (con cualquier estado) y no se tocaron. */
  propuestasExistentes: number;
}

/**
 * Qué es el cartucho, por las palabras del nombre del producto.
 *
 * Solo se usa al CREAR el cartucho. El orden importa: "CARTUCHO DE TONER" es
 * tóner, y "TINTA" gana a "CARTUCHO" porque un cartucho sin más apellido en esta
 * instancia es de tinta (los de HP 667, 954).
 */
export function tipoDeCartucho(nombre: string): CartridgeKind {
  const n = nombre.toUpperCase();
  if (/DRUM|TAMBOR|CILINDRO|UNIDAD DE IMAGEN/.test(n)) return 'DRUM';
  if (/T[OÓ]NER|POLVO|POWDER/.test(n)) return 'TONER';
  if (/TINTA|\bINK\b|BOTELLA|CARTUCHO/.test(n)) return 'TINTA';
  return 'OTRO';
}

/**
 * ¿El producto es el cartucho del fabricante, o un compatible?
 *
 * ORIGINAL solo si el nombre dice la marca del cartucho y NADA indica que sea
 * compatible. Ante la duda, COMPATIBLE: llamar "original" a un compatible es
 * engañar al cliente en piso de venta; llamar "compatible" a un original, como
 * mucho, le hace pensar que es más barato de lo que es.
 */
export function relacionConCartucho(producto: ProductoOdoo, candidato: CandidatoCartucho): ProductRelation {
  const nombre = producto.name.toUpperCase();
  const ref = String(producto.default_code || '').toUpperCase();
  const pareceCompatible = /\bASTA\b|COMPATIBLE|GEN[EÉ]RIC|RECYCLE|REMANUFACTURAD/.test(nombre) || ref.startsWith('A-');
  if (pareceCompatible) return 'COMPATIBLE';
  return new RegExp(`\\b${candidato.marca.toUpperCase()}\\b`).test(nombre) ? 'ORIGINAL' : 'COMPATIBLE';
}

export async function importarPropuestas(productos: ProductoOdoo[]): Promise<ResumenImportacion> {
  const resumen: ResumenImportacion = {
    productos: productos.length,
    sinCandidato: 0,
    marcasCreadas: 0,
    cartuchosCreados: 0,
    propuestasCreadas: 0,
    propuestasExistentes: 0,
  };

  const porProducto = productos.map((p) => ({ producto: p, candidatos: extraerCartuchos(p.name, p.default_code || null) }));
  resumen.sinCandidato = porProducto.filter((x) => x.candidatos.length === 0).length;

  // ── Marcas ────────────────────────────────────────────────────────────────
  const nombresMarca = [...new Set(porProducto.flatMap((x) => x.candidatos.map((c) => c.marca)))];
  const marcasAntes = await prisma.printerBrand.count({ where: { name: { in: nombresMarca } } });
  await prisma.printerBrand.createMany({ data: nombresMarca.map((name) => ({ name })), skipDuplicates: true });
  resumen.marcasCreadas = nombresMarca.length - marcasAntes;
  const marcaId = new Map((await prisma.printerBrand.findMany({ where: { name: { in: nombresMarca } } })).map((m) => [m.name, m.id]));

  // ── Cartuchos ─────────────────────────────────────────────────────────────
  // El primero que aparece fija el `kind`: los productos van ordenados como
  // vengan, y un cartucho existente no se corrige aquí.
  const cartuchos = new Map<string, { brandId: number; code: string; codeNormalized: string; kind: CartridgeKind }>();
  for (const { producto, candidatos } of porProducto) {
    for (const c of candidatos) {
      const brandId = marcaId.get(c.marca)!;
      const clave = `${brandId}:${c.codigoNormalizado}`;
      if (!cartuchos.has(clave)) {
        cartuchos.set(clave, { brandId, code: c.codigo, codeNormalized: c.codigoNormalizado, kind: tipoDeCartucho(producto.name) });
      }
    }
  }
  const filasCartucho = [...cartuchos.values()];
  const existentes = await prisma.cartridge.findMany({
    where: { OR: filasCartucho.map((c) => ({ brandId: c.brandId, codeNormalized: c.codeNormalized })) },
    select: { id: true, brandId: true, codeNormalized: true },
  });
  const nuevos = filasCartucho.filter((c) => !existentes.some((e) => e.brandId === c.brandId && e.codeNormalized === c.codeNormalized));
  if (nuevos.length > 0) {
    await prisma.cartridge.createMany({ data: nuevos, skipDuplicates: true });
  }
  resumen.cartuchosCreados = nuevos.length;
  const cartuchoId = new Map(
    (
      await prisma.cartridge.findMany({
        where: { OR: filasCartucho.map((c) => ({ brandId: c.brandId, codeNormalized: c.codeNormalized })) },
        select: { id: true, brandId: true, codeNormalized: true },
      })
    ).map((c) => [`${c.brandId}:${c.codeNormalized}`, c.id]),
  );

  // ── Propuestas ────────────────────────────────────────────────────────────
  const propuestas = new Map<string, { odooProductTmplId: number; cartridgeId: number; relation: ProductRelation; evidence: string }>();
  for (const { producto, candidatos } of porProducto) {
    for (const c of candidatos) {
      const cartridgeId = cartuchoId.get(`${marcaId.get(c.marca)}:${c.codigoNormalizado}`)!;
      const clave = `${producto.id}:${cartridgeId}`;
      if (!propuestas.has(clave)) {
        propuestas.set(clave, {
          odooProductTmplId: producto.id,
          cartridgeId,
          relation: relacionConCartucho(producto, c),
          // La evidencia es el fragmento literal, recortado a la columna.
          evidence: c.evidencia.slice(0, 255),
        });
      }
    }
  }
  const filasPropuesta = [...propuestas.values()];
  const yaEstaban = filasPropuesta.length
    ? await prisma.productCartridge.count({
        where: { OR: filasPropuesta.map((p) => ({ odooProductTmplId: p.odooProductTmplId, cartridgeId: p.cartridgeId })) },
      })
    : 0;
  // `skipDuplicates`: una fila existente, con el estado que tenga, no se toca.
  const creadas = await prisma.productCartridge.createMany({
    data: filasPropuesta.map((p) => ({ ...p, source: 'PARSEO' as const, status: 'PROPUESTA' as const })),
    skipDuplicates: true,
  });
  resumen.propuestasCreadas = creadas.count;
  resumen.propuestasExistentes = yaEstaban;

  return resumen;
}
