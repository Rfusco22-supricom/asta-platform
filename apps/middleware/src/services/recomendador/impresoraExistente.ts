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
 * La impresora de esa marca con ese nombre normalizado, o la del catálogo que
 * es la misma, o null si hay que crearla.
 */
export async function buscarImpresora(tx: Prisma.TransactionClient, brandId: number, nameNormalized: string): Promise<PrinterModel | null> {
  const exacta = await tx.printerModel.findUnique({ where: { brandId_nameNormalized: { brandId, nameNormalized } } });
  if (exacta) return exacta;

  const catalogo = await tx.printerModel.findMany({ where: { brandId, inOdooCatalog: true }, include: { brand: { select: { name: true } } } });
  const coinciden = catalogo.filter((m) => {
    const clave = claveDelCatalogo(m.brand.name, m.name);
    return clave !== null && esLaDelCatalogo(nameNormalized, clave);
  });
  if (coinciden.length !== 1) return null;
  const { brand: _marca, ...modelo } = coinciden[0]!;
  return modelo;
}
