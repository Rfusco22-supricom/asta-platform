import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { extraerImpresoras } from './extraerImpresoras.js';

/**
 * De los nombres de los productos de Odoo a `printer_models` y a la relación
 * cartucho ↔ impresora (#129, Fase 2 de #56).
 *
 * Es el importador que faltaba. Los otros dos llenan lo suyo:
 *
 *   importar-propuestas        productos de Odoo → cartuchos y producto ↔ cartucho
 *   importar-compatibilidades  la tabla escrita a mano → impresoras y cartucho ↔ impresora
 *   ESTE                       los nombres de Odoo → impresoras y cartucho ↔ impresora
 *
 * El del medio necesita `compatibilidad_productos`, que hoy está vacía fuera de
 * producción. Este no necesita nada que no tengamos ya.
 *
 * ── Qué ata con qué ──────────────────────────────────────────────────────────
 *
 * Las impresoras que dice el nombre, con los cartuchos que ese MISMO producto ya
 * tiene en `product_cartridges`. Un producto sin cartucho no ata nada: hay que
 * pasar antes `importar-propuestas`.
 *
 * Cuando el producto lista varios cartuchos —los ASTA que sustituyen a cuatro:
 * "CB435A/CB436A/CE278A/285"— se propone cada cartucho con cada impresora, y la
 * nota lo dice. Es más de lo que el nombre afirma, porque el nombre no dice qué
 * impresora va con cuál; por eso entra como PROPUESTA y la nota avisa a quien
 * revise de que ahí hay que mirar de verdad.
 *
 * ── Todo entra como PROPUESTA, y repetir no pisa nada ────────────────────────
 *
 * Igual que los otros dos importadores: solo se crea lo que falta, una relación
 * rechazada no vuelve a pendiente y una validada no se toca. Sin `aplicar` se
 * hace el trabajo entero dentro de una transacción y al final se deshace, así
 * los números del simulacro son los de verdad y no hay una segunda versión de la
 * lógica que "cuenta sin escribir".
 */

export interface ProductoConNombre {
  id: number;
  name: string;
}

export interface ResumenImportacionImpresoras {
  productos: number;
  /** Productos de cuyo nombre salió al menos una impresora. */
  conImpresoras: number;
  /** Tienen impresoras en el nombre pero ningún cartucho todavía: no atan nada. */
  sinCartucho: number;
  marcasCreadas: number;
  modelosCreados: number;
  /** Ya estaban en la base, o los repite otro producto de esta misma pasada. */
  modelosRepetidos: number;
  compatibilidadesCreadas: number;
  /** Ya existían con cualquier estado: no se tocan, ni siquiera las RECHAZADAS. */
  compatibilidadesExistentes: number;
  /** Productos que listan más de un cartucho: sus propuestas son las que menos se sostienen solas. */
  conVariosCartuchos: number;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenImportacionImpresoras) {
    super('simulacro');
  }
}

/** La referencia al producto del que salió, para revisar sin abrir Odoo. */
function origenDe(producto: ProductoConNombre, evidencia: string, cuantosCartuchos: number): string {
  const aviso = cuantosCartuchos > 1 ? ` · el producto lista ${cuantosCartuchos} cartuchos: confirmar cuál` : '';
  return `product.template #${producto.id}: ${evidencia}${aviso}`.slice(0, 255);
}

async function importar(tx: Prisma.TransactionClient, productos: ProductoConNombre[]): Promise<ResumenImportacionImpresoras> {
  const r: ResumenImportacionImpresoras = {
    productos: productos.length,
    conImpresoras: 0,
    sinCartucho: 0,
    marcasCreadas: 0,
    modelosCreados: 0,
    modelosRepetidos: 0,
    compatibilidadesCreadas: 0,
    compatibilidadesExistentes: 0,
    conVariosCartuchos: 0,
  };

  // Los cartuchos que ya se sacaron de esos mismos productos. Cualquier estado:
  // que el producto ↔ cartucho esté sin revisar no cambia que el cartucho exista,
  // y las dos revisiones son independientes.
  const enlaces = await tx.productCartridge.findMany({
    where: { odooProductTmplId: { in: productos.map((p) => p.id) } },
    select: { odooProductTmplId: true, cartridgeId: true, cartridge: { select: { code: true } } },
  });
  const cartuchosDe = new Map<number, Array<{ id: number; code: string }>>();
  for (const e of enlaces) {
    cartuchosDe.set(e.odooProductTmplId, [...(cartuchosDe.get(e.odooProductTmplId) ?? []), { id: e.cartridgeId, code: e.cartridge.code }]);
  }

  for (const producto of productos) {
    const cartuchos = cartuchosDe.get(producto.id) ?? [];
    const candidatos = extraerImpresoras(
      producto.name,
      cartuchos.map((c) => c.code),
    );
    if (candidatos.length === 0) continue;
    r.conImpresoras++;
    if (cartuchos.length === 0) {
      r.sinCartucho++;
      continue;
    }
    if (cartuchos.length > 1) r.conVariosCartuchos++;

    for (const candidato of candidatos) {
      // ── La marca ────────────────────────────────────────────────────────────
      // La comparación en MySQL no distingue mayúsculas, así que "HP" encuentra
      // la que ya creó el importador de productos.
      let marca = await tx.printerBrand.findFirst({ where: { name: candidato.marca } });
      if (!marca) {
        marca = await tx.printerBrand.create({ data: { name: candidato.marca } });
        r.marcasCreadas++;
      }

      // ── La impresora ───────────────────────────────────────────────────────
      let modelo = await tx.printerModel.findFirst({ where: { brandId: marca.id, nameNormalized: candidato.nombreNormalizado } });
      if (modelo) {
        r.modelosRepetidos++;
      } else {
        modelo = await tx.printerModel.create({
          data: { brandId: marca.id, name: candidato.nombre, nameNormalized: candidato.nombreNormalizado },
        });
        r.modelosCreados++;
      }

      // ── Cartucho ↔ impresora ───────────────────────────────────────────────
      for (const cartucho of cartuchos) {
        const existe = await tx.cartridgePrinterModel.findUnique({
          where: { cartridgeId_printerModelId: { cartridgeId: cartucho.id, printerModelId: modelo.id } },
        });
        if (existe) {
          r.compatibilidadesExistentes++;
          continue;
        }
        await tx.cartridgePrinterModel.create({
          data: {
            cartridgeId: cartucho.id,
            printerModelId: modelo.id,
            source: 'PARSEO',
            sourceRef: origenDe(producto, candidato.evidencia, cartuchos.length),
            status: 'PROPUESTA',
          },
        });
        r.compatibilidadesCreadas++;
      }
    }
  }

  return r;
}

export async function importarImpresorasDeNombres(
  productos: ProductoConNombre[],
  opciones: { aplicar: boolean },
): Promise<ResumenImportacionImpresoras> {
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
