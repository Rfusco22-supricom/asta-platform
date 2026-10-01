import type { EstadoStock, Impresora, ProductoCompatible } from './api.js';

/**
 * Cómo se le presenta al cliente cada producto compatible (#40).
 *
 * El nombre que llega es el del ERP: «ASTA TONER CB435A/CB436A/CE278A/285» o
 * «HP TONER P1566 / P1606 BLACK ORIGINAL». Es el que entiende el mostrador,
 * así que se enseña, pero en pequeño: a quien está de pie le sirve más «Tóner
 * compatible Asta» y el código del cartucho, que es lo que compara.
 */

/** Asta es la marca propia: los compatibles que vende la tienda se llaman así en el ERP. */
export function esAsta(p: ProductoCompatible): boolean {
  return /^ASTA\b/i.test(p.nombre.trim());
}

/**
 * Tóner listo para poner, o polvo para rellenar un cartucho. El ERP no tiene un
 * campo para esto —los dos son «tóner» en el catálogo de cartuchos—, solo el
 * nombre, y confundirlos es que el cliente se lleve un bote de polvo creyendo
 * que es un cartucho.
 */
export function clase(p: ProductoCompatible): 'toner' | 'polvo' {
  return /\b(POLVO|POWDER)\b/i.test(p.nombre) ? 'polvo' : 'toner';
}

/** «Tóner compatible Asta», «Tóner original HP», «Polvo de recarga Asta». */
export function titulo(p: ProductoCompatible, impresora: Impresora): string {
  const marca = esAsta(p) ? 'Asta' : (p.cartuchos[0]?.marca ?? impresora.marca);
  if (clase(p) === 'polvo') return `Polvo de recarga ${marca}`;
  return p.tipo === 'original' ? `Tóner original ${marca}` : `Tóner compatible ${marca}`;
}

/** Los códigos de cartucho distintos, en el orden en que aparecen. */
export function codigosDeCartucho(productos: ProductoCompatible[]): string[] {
  return [...new Set(productos.flatMap((p) => p.cartuchos.map((c) => c.codigo)))];
}

const ORDEN_STOCK: Record<EstadoStock, number> = { disponible: 0, bajo: 1, agotado: 2 };

/**
 * Lo que hay en tienda, primero. El cliente vino a llevárselo hoy; lo agotado
 * se enseña igual —saber que existe sirve para encargarlo—, pero debajo. Orden
 * estable: dentro de cada estado se respeta el del servidor.
 */
export function ordenarPorStock(productos: ProductoCompatible[]): ProductoCompatible[] {
  return productos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ORDEN_STOCK[a.p.stock] - ORDEN_STOCK[b.p.stock] || a.i - b.i)
    .map(({ p }) => p);
}
