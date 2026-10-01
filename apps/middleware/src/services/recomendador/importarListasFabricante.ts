import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { normalizarModelo } from './normalizar.js';
import { formasDelCodigo } from './separarModelos.js';

/**
 * Listas de impresoras publicadas por el fabricante, cartucho a cartucho (#56).
 *
 * ── Por qué listas sueltas y no «las tablas del fabricante» ──────────────────
 *
 * La Fase 2 del epic esperaba las tablas completas de HP, Canon, Epson…, que
 * dependen de una decisión de negocio. Medido el 2026-10-01: de los 20
 * consumibles más vendidos, 16 tienen el cartucho propuesto pero NINGUNA
 * impresora, y esos 16 comparten solo 12 códigos. Las impresoras de esos 12
 * están publicadas en la web de cada fabricante: para pasar el umbral de #7 no
 * hace falta la tabla entera, hacen falta esas listas.
 *
 * ── Lo que hace y lo que no ──────────────────────────────────────────────────
 *
 * - Todo entra como PROPUESTA con `source = FABRICANTE` y la URL oficial en
 *   `source_ref`, para que quien valide pueda abrirla. Nada se valida aquí: un
 *   falso positivo le vende al cliente un cartucho que no le sirve.
 * - NO crea cartuchos. El cartucho tiene que existir ya, sacado de un producto de
 *   Odoo por `importar-propuestas`: un cartucho sin producto no recomienda nada.
 *   Si no se encuentra, se informa y se sigue.
 * - Se puede repetir: lo que ya existe —propuesto, validado o rechazado, venga de
 *   donde venga— no se toca. Un rechazo no resucita.
 */

export interface ListaFabricante {
  /** Como está en `printer_brands`: la comparación de MySQL no distingue mayúsculas. */
  marca: string;
  /** Códigos del mismo consumible: "105A" y su número de pieza "W1105A". */
  cartuchos: string[];
  /** Tal como los escribe el fabricante, sin la marca delante. */
  impresoras: string[];
  /** Páginas oficiales de donde sale la lista. La primera va a `source_ref`. */
  fuentes: string[];
  /** YYYY-MM-DD: las listas cambian cuando salen modelos nuevos. */
  consultado: string;
}

export interface ResumenListasFabricante {
  listas: number;
  cartuchosEnlazados: number;
  cartuchosNoEncontrados: Array<{ marca: string; codigo: string }>;
  marcasNoEncontradas: string[];
  modelosCreados: number;
  compatibilidadesCreadas: number;
  compatibilidadesExistentes: number;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenListasFabricante) {
    super('simulacro');
  }
}

async function importar(tx: Prisma.TransactionClient, listas: ListaFabricante[]): Promise<ResumenListasFabricante> {
  const r: ResumenListasFabricante = {
    listas: listas.length,
    cartuchosEnlazados: 0,
    cartuchosNoEncontrados: [],
    marcasNoEncontradas: [],
    modelosCreados: 0,
    compatibilidadesCreadas: 0,
    compatibilidadesExistentes: 0,
  };

  for (const lista of listas) {
    const marca = await tx.printerBrand.findFirst({ where: { name: lista.marca.trim() } });
    if (!marca) {
      if (!r.marcasNoEncontradas.includes(lista.marca)) r.marcasNoEncontradas.push(lista.marca);
      continue;
    }

    const cartuchos: number[] = [];
    for (const codigo of lista.cartuchos) {
      const formas = formasDelCodigo(codigo, lista.marca);
      const existentes = await tx.cartridge.findMany({ where: { brandId: marca.id, codeNormalized: { in: formas } } });
      const cartucho = formas.map((n) => existentes.find((c) => c.codeNormalized === n)).find(Boolean);
      if (cartucho) cartuchos.push(cartucho.id);
      else r.cartuchosNoEncontrados.push({ marca: lista.marca, codigo });
    }
    if (cartuchos.length === 0) continue;
    r.cartuchosEnlazados += cartuchos.length;

    const sourceRef = lista.fuentes[0]?.slice(0, 255) ?? null;

    // Una vez por impresora NORMALIZADA: "OfficeJet Pro 8210" y "Officejet Pro
    // 8210" son la misma fila, y contarla dos veces falsearía el resumen.
    const unicas = new Map<string, string>();
    for (const i of lista.impresoras) {
      const nombre = i.trim();
      const n = normalizarModelo(nombre).slice(0, 120);
      if (n && !unicas.has(n)) unicas.set(n, nombre);
    }

    for (const [nameNormalized, nombre] of unicas) {
      let modelo = await tx.printerModel.findUnique({ where: { brandId_nameNormalized: { brandId: marca.id, nameNormalized } } });
      if (!modelo) {
        modelo = await tx.printerModel.create({ data: { brandId: marca.id, name: nombre.slice(0, 120), nameNormalized } });
        r.modelosCreados++;
      }

      for (const cartridgeId of cartuchos) {
        const creada = await tx.cartridgePrinterModel.createMany({
          data: [{ cartridgeId, printerModelId: modelo.id, source: 'FABRICANTE', sourceRef, status: 'PROPUESTA' }],
          skipDuplicates: true,
        });
        if (creada.count) r.compatibilidadesCreadas++;
        else r.compatibilidadesExistentes++;
      }
    }
  }

  return r;
}

export async function importarListasFabricante(
  listas: ListaFabricante[],
  opciones: { aplicar: boolean },
): Promise<ResumenListasFabricante> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const r = await importar(tx, listas);
        // Lanzar dentro de la transacción la deshace entera.
        if (!opciones.aplicar) throw new Simulacro(r);
        return r;
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof Simulacro) return error.resumen;
    throw error;
  }
}
