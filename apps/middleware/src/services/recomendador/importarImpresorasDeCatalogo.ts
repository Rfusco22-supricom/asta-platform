import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { extraerImpresoraDeCatalogo, type ImpresoraDeCatalogo, type MotivoDescarte } from './extraerImpresoraDeCatalogo.js';

/**
 * De la categoría IMPRESORA de Odoo a `printer_models` (#40).
 *
 * Los otros importadores sacan impresoras de lo que dicen los TÓNERS. Este carga
 * las que Supricom VENDE, que no aparecían en el kiosco: de 178 productos de la
 * categoría, una sola estaba en `printer_models`. El cliente que compró aquí su
 * impresora tecleaba el modelo y el kiosco le decía que no la conocía.
 *
 * ── Qué escribe ──────────────────────────────────────────────────────────────
 *
 * Solo impresoras, marcadas con `inOdooCatalog`. Ninguna compatibilidad: de qué
 * tóner usa cada una no dice nada el nombre, y eso sigue pasando por la revisión
 * del panel. Con la marca la impresora ya sale en el kiosco
 * (`IMPRESORA_PUBLICABLE`), que manda al mostrador mientras no tenga tóner
 * validado.
 *
 * ── Sin duplicar ─────────────────────────────────────────────────────────────
 *
 * Una impresora que ya estaba —la creó otro importador desde el nombre de un
 * tóner, con otro nombre: «MFP M428FDW» frente a «LaserJet Pro MFP M428FDW»—
 * no se vuelve a crear: se marca. Se reconoce por la clave del modelo (ver
 * `extraerImpresoraDeCatalogo`), y por eso la clave tiene que tener letras y
 * cifras para buscarse al final de otro nombre: «580» acaba en demasiados.
 *
 * Una impresora DESACTIVADA se marca pero no se reactiva: alguien la retiró, y
 * el porqué no lo sabe este importador.
 *
 * ── Como los otros ───────────────────────────────────────────────────────────
 *
 * Repetirlo no cambia nada, y sin `aplicar` hace el trabajo entero dentro de una
 * transacción que al final se deshace: los números del simulacro son los de
 * verdad.
 */

export interface ProductoImpresora {
  id: number;
  name: string;
  default_code: string | false;
}

export interface ResumenImportacionCatalogo {
  productos: number;
  descartados: Record<MotivoDescarte, number>;
  /** Impresoras distintas: varios productos son la misma («OPEN BOX», «-EX»). */
  impresoras: number;
  marcasCreadas: number;
  creadas: number;
  /** Ya estaban en `printer_models` sin la marca: ahora la tienen. */
  marcadas: number;
  /** Ya estaban y ya marcadas: no se toca nada. */
  yaMarcadas: number;
  /** Ya estaban pero desactivadas: se marcan y siguen sin salir en el kiosco. */
  desactivadas: number;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenImportacionCatalogo) {
    super('simulacro');
  }
}

/** Productos que son la misma impresora, con el nombre más completo de los que tenga. */
export function agruparPorModelo(productos: ProductoImpresora[]): {
  impresoras: ImpresoraDeCatalogo[];
  descartados: Record<MotivoDescarte, number>;
} {
  const descartados: Record<MotivoDescarte, number> = { no_es_impresora: 0, sin_marca: 0, sin_modelo: 0 };
  const porClave = new Map<string, ImpresoraDeCatalogo>();
  for (const p of productos) {
    const r = extraerImpresoraDeCatalogo(p.name, p.default_code || null);
    if (!r.ok) {
      descartados[r.motivo]++;
      continue;
    }
    const k = `${r.impresora.marca}:${r.impresora.clave}`;
    const antes = porClave.get(k);
    // «PIXMA G4110» antes que «G4110»: la familia ayuda a reconocerla.
    if (!antes || r.impresora.nombre.length > antes.nombre.length) porClave.set(k, r.impresora);
  }
  return { impresoras: [...porClave.values()], descartados };
}

/** ¿Es este modelo de la base la misma impresora? */
function esLaMisma(nombreNormalizado: string, impresora: ImpresoraDeCatalogo): boolean {
  if (nombreNormalizado === impresora.nombreNormalizado || nombreNormalizado === impresora.clave) return true;
  const claveFiable = impresora.clave.length >= 4 && /[a-z]/.test(impresora.clave) && /\d/.test(impresora.clave);
  return claveFiable && nombreNormalizado.endsWith(impresora.clave);
}

async function importar(tx: Prisma.TransactionClient, productos: ProductoImpresora[]): Promise<ResumenImportacionCatalogo> {
  const { impresoras, descartados } = agruparPorModelo(productos);
  const r: ResumenImportacionCatalogo = {
    productos: productos.length,
    descartados,
    impresoras: impresoras.length,
    marcasCreadas: 0,
    creadas: 0,
    marcadas: 0,
    yaMarcadas: 0,
    desactivadas: 0,
  };

  const marcas = new Map<string, { id: number; modelos: Array<{ id: number; nameNormalized: string; isActive: boolean; inOdooCatalog: boolean }> }>();
  const marcaDe = async (nombre: string) => {
    const enMemoria = marcas.get(nombre);
    if (enMemoria) return enMemoria;
    // La comparación en MySQL no distingue mayúsculas: "HP" encuentra la de los otros importadores.
    let marca = await tx.printerBrand.findFirst({ where: { name: nombre } });
    if (!marca) {
      marca = await tx.printerBrand.create({ data: { name: nombre } });
      r.marcasCreadas++;
    }
    const modelos = await tx.printerModel.findMany({
      where: { brandId: marca.id },
      select: { id: true, nameNormalized: true, isActive: true, inOdooCatalog: true },
    });
    const entrada = { id: marca.id, modelos };
    marcas.set(nombre, entrada);
    return entrada;
  };

  for (const impresora of impresoras) {
    const marca = await marcaDe(impresora.marca);
    const existentes = marca.modelos.filter((m) => esLaMisma(m.nameNormalized, impresora));

    if (existentes.length === 0) {
      const creada = await tx.printerModel.create({
        data: { brandId: marca.id, name: impresora.nombre, nameNormalized: impresora.nombreNormalizado, inOdooCatalog: true },
        select: { id: true, nameNormalized: true, isActive: true, inOdooCatalog: true },
      });
      marca.modelos.push(creada);
      r.creadas++;
      continue;
    }

    // Puede haber más de una: los importadores de tóners crearon a veces la
    // misma impresora con dos nombres. Se marcan todas; unirlas es otra cosa.
    for (const m of existentes) {
      if (!m.isActive) r.desactivadas++;
      if (m.inOdooCatalog) {
        r.yaMarcadas++;
        continue;
      }
      await tx.printerModel.update({ where: { id: m.id }, data: { inOdooCatalog: true } });
      m.inOdooCatalog = true;
      r.marcadas++;
    }
  }

  return r;
}

export async function importarImpresorasDeCatalogo(
  productos: ProductoImpresora[],
  opciones: { aplicar: boolean },
): Promise<ResumenImportacionCatalogo> {
  if (opciones.aplicar) {
    return prisma.$transaction((tx) => importar(tx, productos), { timeout: 120_000 });
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        throw new Simulacro(await importar(tx, productos));
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof Simulacro) return error.resumen;
    throw error;
  }
  throw new Error('inalcanzable: el simulacro siempre deshace');
}
