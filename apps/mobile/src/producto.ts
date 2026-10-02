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

export type Clase = 'toner' | 'polvo' | 'tinta' | 'tambor' | 'otro';

/**
 * Qué es el producto: tóner, polvo de recarga, tinta, tambor u otra cosa.
 *
 * El polvo sale del NOMBRE: el ERP no tiene un campo para esto —polvo y tóner
 * son «tóner» en el catálogo de cartuchos—, y confundirlos es que el cliente se
 * lleve un bote de polvo creyendo que es un cartucho.
 *
 * Lo demás sale del tipo de los cartuchos que manda el servidor. Una botella de
 * tinta o un tambor no son tóner, y llamarlos así es la misma confusión: el
 * cliente pide en el mostrador el tambor creyendo que es el tóner. Si el tipo
 * no es uno solo, o no se sabe, no se afirma nada: «otro».
 */
export function clase(p: ProductoCompatible): Clase {
  if (/\b(POLVO|POWDER)\b/i.test(p.nombre)) return 'polvo';
  const tipos = new Set(p.cartuchos.map((c) => c.tipo));
  const [tipo] = tipos;
  if (tipos.size === 1 && (tipo === 'toner' || tipo === 'tinta' || tipo === 'tambor')) return tipo;
  return 'otro';
}

const NOMBRE_DE_CLASE: Record<Exclude<Clase, 'polvo'>, string> = {
  toner: 'Tóner',
  tinta: 'Tinta',
  tambor: 'Tambor',
  otro: 'Consumible',
};

/** «Tóner compatible Asta», «Tambor original Brother», «Polvo de recarga Asta». */
export function titulo(p: ProductoCompatible, impresora: Impresora): string {
  const marca = esAsta(p) ? 'Asta' : (p.cartuchos[0]?.marca ?? impresora.marca);
  const c = clase(p);
  if (c === 'polvo') return `Polvo de recarga ${marca}`;
  return `${NOMBRE_DE_CLASE[c]} ${p.tipo === 'original' ? 'original' : 'compatible'} ${marca}`;
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
