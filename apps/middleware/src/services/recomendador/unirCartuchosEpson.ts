import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/**
 * Las botellas Epson guardadas sin su T: "544" → "T544" (#56).
 *
 * Hasta que `extraerCartuchos` les puso la T (`conTDeBotella`), el número
 * comercial de las referencias ASTA ("A-544BK") y de algunos nombres ("EPSON 664
 * - BOTELLA") creaba un cartucho "544" distinto del "T544" que sale de la
 * referencia del original ("T544120-AL"). Las impresoras estaban en el T544, la
 * tinta ASTA en el 544, y el kiosco nunca las juntaba: la EcoTank L3110 solo
 * enseñaba las botellas Epson.
 *
 * Por cada cartucho Epson cuyo código son tres cifras:
 *
 *   · si existe el de la T, sus enlaces pasan a ese y el de sin T se retira;
 *   · si no, se renombra.
 *
 * Un enlace que ya estaba en el de la T se queda como está allí: lo decidido en
 * el cartucho de las impresoras manda. Nada pasa a validado por el camino.
 *
 * ── Sin borrar nada ──────────────────────────────────────────────────────────
 *
 * `asta_app` no tiene DELETE en estas tablas (`004_usuarios.sql`, #105), y la
 * primera versión de esto lo necesitaba: en producción falló con «DELETE command
 * denied». Así que los enlaces se MUEVEN (UPDATE de `cartridge_id`) y el cartucho
 * vacío se retira renombrándolo a `RETIRADO-664`, un código que ningún producto ni
 * ninguna lista va a escribir. Si le queda algún enlace repetido —el mismo
 * producto ya estaba en el de la T—, se queda en el retirado y se lista, para
 * rechazarlo en el panel.
 */

export interface ResumenUnionEpson {
  unidos: Array<{ de: string; a: string; productos: number; impresoras: number; repetidos: number; retirado: string }>;
  renombrados: Array<{ de: string; a: string }>;
}

class Simulacro extends Error {
  constructor(readonly resumen: ResumenUnionEpson) {
    super('simulacro');
  }
}

export async function unirEn(tx: Prisma.TransactionClient): Promise<ResumenUnionEpson> {
  const r: ResumenUnionEpson = { unidos: [], renombrados: [] };
  const sinT = (await tx.cartridge.findMany({ where: { brand: { name: 'Epson' } } })).filter((c) => /^\d{3}$/.test(c.codeNormalized));

  for (const c of sinT) {
    const codigoT = `T${c.code}`;
    const destino = await tx.cartridge.findUnique({ where: { brandId_codeNormalized: { brandId: c.brandId, codeNormalized: `t${c.codeNormalized}` } } });
    if (!destino) {
      await tx.cartridge.update({ where: { id: c.id }, data: { code: codigoT, codeNormalized: `t${c.codeNormalized}` } });
      r.renombrados.push({ de: c.code, a: codigoT });
      continue;
    }

    let productos = 0;
    let impresoras = 0;
    let repetidos = 0;
    for (const p of await tx.productCartridge.findMany({ where: { cartridgeId: c.id } })) {
      const ya = await tx.productCartridge.findUnique({ where: { odooProductTmplId_cartridgeId: { odooProductTmplId: p.odooProductTmplId, cartridgeId: destino.id } } });
      if (ya) repetidos++;
      else {
        await tx.productCartridge.update({ where: { odooProductTmplId_cartridgeId: { odooProductTmplId: p.odooProductTmplId, cartridgeId: c.id } }, data: { cartridgeId: destino.id } });
        productos++;
      }
    }
    for (const i of await tx.cartridgePrinterModel.findMany({ where: { cartridgeId: c.id } })) {
      const ya = await tx.cartridgePrinterModel.findUnique({ where: { cartridgeId_printerModelId: { cartridgeId: destino.id, printerModelId: i.printerModelId } } });
      if (ya) repetidos++;
      else {
        await tx.cartridgePrinterModel.update({ where: { cartridgeId_printerModelId: { cartridgeId: c.id, printerModelId: i.printerModelId } }, data: { cartridgeId: destino.id } });
        impresoras++;
      }
    }
    const retirado = `RETIRADO-${c.code}`;
    await tx.cartridge.update({ where: { id: c.id }, data: { code: retirado, codeNormalized: `retirado${c.codeNormalized}` } });
    r.unidos.push({ de: c.code, a: destino.code, productos, impresoras, repetidos, retirado });
  }
  return r;
}

export async function unirCartuchosEpson(opciones: { aplicar: boolean }): Promise<ResumenUnionEpson> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const r = await unirEn(tx);
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
