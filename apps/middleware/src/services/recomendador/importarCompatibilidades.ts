import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { normalizarModelo } from './normalizar.js';
import { formasDelCodigo, separarModelos } from './separarModelos.js';

/**
 * De `compatibilidad_productos` (la tabla mantenida a mano) a las tablas del
 * recomendador: marcas, modelos de impresora, cartuchos y la relación
 * impresora ↔ cartucho (#56).
 *
 * ── Todo entra como PROPUESTA ────────────────────────────────────────────────
 *
 * El código ↔ modelos lo escribió una persona, pero separar «1010/1012/1015» en
 * impresoras lo hace `separarModelos`, y la tabla trae errores reales: la fila
 * del CE278A lista «P560/P566…» por «P1560/P1566…». Validado sin mirar, el kiosco
 * le diría a quien tiene una M130 que le sirve el CE285A. Se revisa en la pestaña
 * «Impresoras» del panel, con el texto original de la fila al lado.
 *
 * ── Volver a importar nunca pisa lo revisado ─────────────────────────────────
 *
 * Igual que `importarPropuestas`: solo se crea lo que falta. Una relación
 * rechazada no vuelve a pendiente, y el tipo de un cartucho existente no se toca.
 * Del cartucho existente solo se RELLENAN el rendimiento y el color si están
 * vacíos: son datos que esta tabla trae y el importador de productos no.
 *
 * ── Simulacro ────────────────────────────────────────────────────────────────
 *
 * Sin `aplicar`, se hace el trabajo entero dentro de una transacción y al final
 * se deshace. Así los números del simulacro son los que saldrán de verdad, sin
 * mantener una segunda versión de la lógica que "cuenta sin escribir".
 */

export interface FilaFuente {
  id: number;
  code: string;
  marca: string;
  modelo: string;
  rendimientoPag: number | null;
}

export interface ResumenImportacionCompatibilidades {
  filas: number;
  marcasCreadas: number;
  modelosCreados: number;
  cartuchosCreados: number;
  /** Filas cuyo código ya existía como cartucho: las que cruzan con productos de Odoo. */
  cartuchosQueCruzan: number;
  rendimientosRellenados: number;
  coloresRellenados: number;
  compatibilidadesCreadas: number;
  compatibilidadesExistentes: number;
  /** Filas de las que no salió ningún modelo: hay que arreglar el texto. */
  sinModelos: Array<{ id: number; code: string; modelo: string }>;
  /** Cartuchos que no existían: no hay producto de Odoo que los venda, o el código tiene una errata. */
  codigosSinCruce: Array<{ id: number; code: string }>;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenImportacionCompatibilidades) {
    super('simulacro');
  }
}

/** "CANON" → "Canon"; "HP" se queda: las siglas de dos letras no se capitalizan. */
function nombreDeMarca(marca: string): string {
  const m = marca.trim();
  return m.length <= 2 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
}

/** La referencia a la fila de origen, para revisar sin abrir phpMyAdmin. */
const origenDe = (f: FilaFuente) => `compatibilidad_productos #${f.id}: ${f.modelo}`.slice(0, 255);

async function importar(tx: Prisma.TransactionClient, filas: FilaFuente[]): Promise<ResumenImportacionCompatibilidades> {
  const r: ResumenImportacionCompatibilidades = {
    filas: filas.length,
    marcasCreadas: 0,
    modelosCreados: 0,
    cartuchosCreados: 0,
    cartuchosQueCruzan: 0,
    rendimientosRellenados: 0,
    coloresRellenados: 0,
    compatibilidadesCreadas: 0,
    compatibilidadesExistentes: 0,
    sinModelos: [],
    codigosSinCruce: [],
  };

  // Marcas: la comparación en MySQL no distingue mayúsculas, así que "CANON"
  // encuentra la "Canon" que creó el importador de productos.
  const marcas = new Map<string, number>();
  for (const nombre of [...new Set(filas.map((f) => f.marca.trim().toLowerCase()))]) {
    let marca = await tx.printerBrand.findFirst({ where: { name: nombre } });
    if (!marca) {
      marca = await tx.printerBrand.create({ data: { name: nombreDeMarca(nombre) } });
      r.marcasCreadas++;
    }
    marcas.set(nombre, marca.id);
  }

  for (const f of filas) {
    const brandId = marcas.get(f.marca.trim().toLowerCase())!;
    const { modelos, color } = separarModelos(f.modelo, f.marca);

    // ── El cartucho ─────────────────────────────────────────────────────────
    const formas = formasDelCodigo(f.code, f.marca);
    const existentes = await tx.cartridge.findMany({ where: { brandId, codeNormalized: { in: formas } } });
    // La forma exacta primero: "CRG055" no debe caer en "055" si "crg055" ya existe.
    let cartucho = formas.map((n) => existentes.find((c) => c.codeNormalized === n)).find(Boolean);
    if (cartucho) {
      r.cartuchosQueCruzan++;
      const relleno: Prisma.CartridgeUpdateInput = {};
      if (cartucho.yieldPages === null && f.rendimientoPag && f.rendimientoPag > 0) {
        relleno.yieldPages = f.rendimientoPag;
        r.rendimientosRellenados++;
      }
      if (cartucho.color === null && color) {
        relleno.color = color;
        r.coloresRellenados++;
      }
      if (Object.keys(relleno).length) await tx.cartridge.update({ where: { id: cartucho.id }, data: relleno });
    } else {
      cartucho = await tx.cartridge.create({
        data: {
          brandId,
          code: f.code.trim(),
          codeNormalized: formas[0],
          // La tabla es de tóneres láser; un tambor mal clasificado se corrige en el panel.
          kind: 'TONER',
          color,
          yieldPages: f.rendimientoPag && f.rendimientoPag > 0 ? f.rendimientoPag : null,
        },
      });
      r.cartuchosCreados++;
      r.codigosSinCruce.push({ id: f.id, code: f.code });
    }

    if (modelos.length === 0) {
      r.sinModelos.push({ id: f.id, code: f.code, modelo: f.modelo });
      continue;
    }

    // ── Las impresoras y la relación ───────────────────────────────────────
    for (const nombre of modelos) {
      const nameNormalized = normalizarModelo(nombre).slice(0, 120);
      let modelo = await tx.printerModel.findUnique({ where: { brandId_nameNormalized: { brandId, nameNormalized } } });
      if (!modelo) {
        modelo = await tx.printerModel.create({ data: { brandId, name: nombre.slice(0, 120), nameNormalized } });
        r.modelosCreados++;
      }
      const creada = await tx.cartridgePrinterModel.createMany({
        data: [{ cartridgeId: cartucho.id, printerModelId: modelo.id, source: 'MANUAL', sourceRef: origenDe(f), status: 'PROPUESTA' }],
        skipDuplicates: true,
      });
      if (creada.count) r.compatibilidadesCreadas++;
      else r.compatibilidadesExistentes++;
    }
  }

  return r;
}

export async function importarCompatibilidades(
  filas: FilaFuente[],
  opciones: { aplicar: boolean },
): Promise<ResumenImportacionCompatibilidades> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const r = await importar(tx, filas);
        // Lanzar dentro de la transacción la deshace entera.
        if (!opciones.aplicar) throw new Simulacro(r);
        return r;
      },
      // ~85 filas × ~10 modelos son del orden de mil consultas: el límite por
      // defecto de 5 s de Prisma no alcanza.
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof Simulacro) return error.resumen;
    throw error;
  }
}
