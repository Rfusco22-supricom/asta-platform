import type { Prisma, PrinterModel } from '@prisma/client';
import { extraerImpresoraDeCatalogo } from './extraerImpresoraDeCatalogo.js';

/**
 * ¿Ya existe esta impresora? Antes de crear una, en los CUATRO sitios que crean
 * impresoras: los tres importadores de tóners y la propuesta de un vendedor
 * desde el panel (#40).
 *
 * ── Por qué no basta con el nombre exacto ────────────────────────────────────
 *
 * Las impresoras que vende Supricom entran con el nombre de su ficha en Odoo,
 * familia incluida: «EcoTank L3250», «WorkForce Pro C5310». Un tóner las nombra
 * a su manera —«L3250», «WORKFORCE WF C5310»— y un vendedor, a la suya. Con el
 * nombre exacto, cada uno creaba otra impresora, y el kiosco enseñaba dos: una
 * con su tóner y otra que manda al mostrador. Pasa si el catálogo se importa
 * ANTES que los tóners, que es el orden en que se hizo en producción.
 *
 * ── Prudente a propósito ─────────────────────────────────────────────────────
 *
 * Solo se reconoce una impresora DEL CATÁLOGO, por la clave de su modelo
 * (ver `extraerImpresoraDeCatalogo`), y solo cuando:
 *
 *   · el nombre nuevo es la clave, o acaba en ella y la clave empieza por letra
 *     y lleva cifras: «wfc5310» acaba en «c5310», pero una clave como «107w»
 *     acabaría siendo el final de demasiados modelos;
 *   · hay UNA sola candidata. Con dos, no se elige.
 *
 * Unir dos impresoras distintas es peor que duplicar una: las propuestas de
 * tóner irían a la que no es. Ante la duda, se crea, como antes.
 */

/** La clave del modelo de una impresora del catálogo, o null si su nombre ya no se lee. */
export function claveDelCatalogo(marca: string, nombre: string): string | null {
  const r = extraerImpresoraDeCatalogo(`${marca} ${nombre}`, null);
  return r.ok ? r.impresora.clave : null;
}

/** ¿El nombre normalizado `nuevo` es la impresora del catálogo de clave `clave`? */
export function esLaDelCatalogo(nuevo: string, clave: string): boolean {
  if (nuevo === clave) return true;
  return clave.length >= 4 && /^[a-z]/.test(clave) && /\d/.test(clave) && nuevo.endsWith(clave);
}

/**
 * ¿Son la misma impresora dos nombres que no vienen del catálogo? (#173)
 *
 * Lo de arriba solo reconoce impresoras DEL CATÁLOGO, y eso deja fuera el caso
 * más común cuando se pasan varios importadores: la L3110 no la vendemos, así
 * que la lista del fabricante crea «EcoTank L3110» y el nombre de un tóner crea
 * «L3110», sin nada en medio con lo que compararlas. Medido sobre los cuatro
 * importadores: **12 pares duplicados** de 298 impresoras.
 *
 * La regla es la misma de antes, aplicada ahora entre dos nombres cualesquiera:
 * uno acaba en el otro. Y con los mismos frenos, porque unir dos impresoras
 * distintas sigue siendo peor que duplicar una:
 *
 *   · el nombre corto tiene que medir 4 o más y llevar alguna cifra, para que
 *     «laser» no se coma a «laserjet»;
 *   · acabar en, no contener: «LaserJet Pro M404dn» NO es la «M404», que es
 *     otro modelo, porque no acaba en «m404»;
 *   · y si hay dos candidatas, no se elige ninguna.
 */
export function esLaMisma(uno: string, otro: string): boolean {
  const [corta, larga] = uno.length <= otro.length ? [uno, otro] : [otro, uno];
  return corta.length >= 4 && /\d/.test(corta) && larga !== corta && larga.endsWith(corta);
}

/**
 * La impresora de esa marca con ese nombre normalizado, la del catálogo que es
 * la misma, la que ya existe con otro nombre, o null si hay que crearla.
 */
export async function buscarImpresora(tx: Prisma.TransactionClient, brandId: number, nameNormalized: string): Promise<PrinterModel | null> {
  const exacta = await tx.printerModel.findUnique({ where: { brandId_nameNormalized: { brandId, nameNormalized } } });
  if (exacta?.isActive === false) {
    // Desactivada al unirla con otra (`unirImpresorasDuplicadas`): su nombre es
    // ahora un alias de la que se quedó, y lo que se importe va a esa. Sin
    // alias, la retiró alguien a propósito, y se devuelve tal cual, como antes.
    const unida = await tx.printerModel.findMany({
      where: { brandId, isActive: true, aliases: { some: { aliasNormalized: nameNormalized, isActive: true } } },
    });
    return unida.length === 1 ? unida[0]! : exacta;
  }
  if (exacta) return exacta;

  const deLaMarca = await tx.printerModel.findMany({ where: { brandId }, include: { brand: { select: { name: true } } } });
  const coinciden = deLaMarca.filter((m) => {
    if (!m.inOdooCatalog) return false;
    const clave = claveDelCatalogo(m.brand.name, m.name);
    return clave !== null && esLaDelCatalogo(nameNormalized, clave);
  });
  // Con dos del catálogo que encajan no se elige, y tampoco se baja a la regla
  // de abajo: si la clave del catálogo ya era ambigua, el nombre suelto lo es más.
  if (coinciden.length > 1) return null;
  if (coinciden.length === 0) {
    const parecidas = deLaMarca.filter((m) => esLaMisma(m.nameNormalized, nameNormalized));
    if (parecidas.length !== 1) return null;
    coinciden.push(parecidas[0]!);
  }
  const { brand: _marca, ...modelo } = coinciden[0]!;
  return modelo;
}
