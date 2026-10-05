import { extraerCartuchos } from '../recomendador/extraerCartuchos.js';
import { tipoDeCartucho } from '../recomendador/importarPropuestas.js';

/**
 * ¿Qué producto ASTA sirve en lugar de este consumible de otra marca? (#40,
 * «Pásale a ASTA»).
 *
 * Por el CÓDIGO DE CARTUCHO del nombre, el mismo que lee el recomendador
 * (`extraerCartuchos`): «HP TONER 87X NEGRO» y «ASTA TONER CF287X» llevan los
 * dos `HP:cf287x`. Que compartan código no basta, y el resto de condiciones
 * salen de casos reales del catálogo (exploración del 2-oct-2026):
 *
 *   · el mismo TIPO: tóner con tóner, tinta con tinta, tambor con tambor;
 *   · el mismo COLOR cuando los dos lo dicen: el código no lo lleva
 *     («CRG-054 Y» y «CRG-054 negro» son los dos `Canon:054`);
 *   · el ASTA tiene que ser ASTA de verdad: hay productos de la marca 951 que
 *     son originales revendidos (CRG-047, DR-820…). Lo es si el nombre dice
 *     ASTA o la referencia empieza por «A-»;
 *   · nunca un componente suelto: chip, polvo, OPC/cilindro, material POP.
 *     «CON CHIP» y «NO CHIP» sí son tóner;
 *   · Epson escribe «T544» o «544» según el producto: son el mismo.
 *
 * Ante la duda, NO se empareja: sugerirle al vendedor un ASTA que no le sirve
 * al cliente es peor que no sugerir nada.
 */

export interface ProductoConsumible {
  id: number;
  name: string;
  default_code: string | false;
}

export type Color = 'K' | 'C' | 'M' | 'Y' | 'TRICOLOR';

/** Las claves «marca:código» del cartucho, con Epson «t544» y «544» igualados. */
export function clavesDe(p: Pick<ProductoConsumible, 'name' | 'default_code'>): Set<string> {
  const claves = new Set<string>();
  for (const c of extraerCartuchos(p.name, p.default_code || null)) {
    let codigo = c.codigoNormalizado;
    if (c.marca === 'Epson') codigo = codigo.replace(/^t(\d{3})/, '$1');
    claves.add(`${c.marca}:${codigo}`);
  }
  return claves;
}

/**
 * El color, si el producto lo dice. Primero por las palabras del nombre; si no,
 * por una letra suelta al final del nombre («… NO CHIP Y») o de la referencia
 * («TN-227Y», «A-CRG-054Y», «W2021XC-EX»). `null` = no lo dice.
 *
 * «COLOR» suelto no cuenta: aparece en familias de impresora («COLOR LASERJET»).
 */
export function colorDe(p: Pick<ProductoConsumible, 'name' | 'default_code'>): Color | null {
  const n = p.name.toUpperCase();
  if (/\bTRI-?COLOR\b/.test(n)) return 'TRICOLOR';
  if (/\b(NEGRO|BLACK|BLK)\b/.test(n)) return 'K';
  if (/\b(CYAN|CIAN)\b/.test(n)) return 'C';
  if (/\bMAGENTA\b/.test(n)) return 'M';
  if (/\b(YELLOW|AMARILLO)\b/.test(n)) return 'Y';

  const final = /\s(BK|K|C|M|Y)\s*$/.exec(n.trim());
  if (final) return final[1] === 'BK' ? 'K' : (final[1] as Color);

  const ref = String(p.default_code || '').toUpperCase().replace(/-(EX|AL|OB|CH|CL|\d)$/, '');
  // Tras una cifra, un guion o la «X» de alto rendimiento: «TN-227C», «W2021XC».
  const sufijo = /(?:\d|-|X)(BK|C|M|Y)$/.exec(ref);
  if (sufijo) return sufijo[1] === 'BK' ? 'K' : (sufijo[1] as Color);
  return null;
}

/** Una pieza suelta, no un consumible que se pone tal cual. */
export function esComponente(nombre: string): boolean {
  const n = nombre.toUpperCase();
  if (/\b(POLVO|POWDER|OPC|CILINDRO)\b|MATERIAL\s+POP|\bPOP\b/.test(n)) return true;
  return /\bCHIP\b/.test(n) && !/\b(CON|NO|SIN)\s+CHIP\b/.test(n);
}

/** Un producto de la marca 951 que es ASTA de verdad, y no un original revendido. */
export function esAstaDeVerdad(p: Pick<ProductoConsumible, 'name' | 'default_code'>): boolean {
  return /\bASTA\b/i.test(p.name) || /^A-/i.test(String(p.default_code || ''));
}

/**
 * Los productos ASTA del catálogo que sirven en lugar de `original`. Vacío si
 * no hay ninguno seguro.
 */
export function equivalentesAsta<T extends ProductoConsumible>(original: ProductoConsumible, catalogoAsta: T[]): T[] {
  if (esComponente(original.name)) return [];
  const claves = clavesDe(original);
  if (claves.size === 0) return [];
  const tipo = tipoDeCartucho(original.name);
  const color = colorDe(original);

  return catalogoAsta.filter((a) => {
    if (!esAstaDeVerdad(a) || esComponente(a.name)) return false;
    if (![...clavesDe(a)].some((k) => claves.has(k))) return false;
    const tipoAsta = tipoDeCartucho(a.name);
    if (tipo !== 'OTRO' && tipoAsta !== 'OTRO' && tipo !== tipoAsta) return false;
    const colorAsta = colorDe(a);
    if (color && colorAsta && color !== colorAsta) return false;
    return true;
  });
}
