import { normalizarModelo } from './normalizar.js';
import { separarModelos } from './separarModelos.js';

/**
 * Qué impresoras menciona el nombre de un producto de Odoo (#129, Fase 2 de #56).
 *
 * Es la mitad que falta del esquema de #101. La otra —producto ↔ cartucho— la
 * saca `extraerCartuchos` del mismo nombre; aquí se lee el otro trozo:
 *
 *   ASTA TONER HP CE255A LaserJet P3010/3015d/3015dn/3015n/Pro M521/MFP M525c
 *                        └────────────── esto ──────────────────────────────┘
 *
 * ── Por qué del nombre, y no de una tabla del fabricante ─────────────────────
 *
 * Porque la tabla no la tenemos y esto sí. Medido sobre las 942 plantillas de
 * CONSUMIBLES, 262 dicen en el nombre para qué impresora son. No cubre el
 * catálogo entero —el 76 % solo lleva el código del cartucho—, pero hoy
 * `printer_models` está a cero, y con cero el kiosco no puede recomendar nada
 * aunque se valide todo lo demás.
 *
 * ── Lo que promete, y lo que no ──────────────────────────────────────────────
 *
 * CANDIDATOS. Todo lo que sale de aquí entra como PROPUESTA y lo valida una
 * persona. El error que hay que evitar está escrito en #56: una compatibilidad
 * falsa le vende al cliente un tóner que no le sirve, y se lo vende en piso de
 * venta. Por eso aquí se prefiere **no proponer** a proponer de más, al revés
 * que en `extraerCartuchos`: allí un código de más se descarta en la revisión de
 * un vistazo, y aquí una impresora de más es exactamente el fallo que no se
 * puede cometer.
 *
 * En concreto, NO se propone nada cuando:
 *
 *   · no hay una familia de impresora reconocida ni una tanda de códigos que
 *     solo pueden ser impresoras: "ASTA CHIP W1105A/105A" parece una lista de
 *     modelos y son dos códigos de cartucho;
 *   · el fragmento es uno de los cartuchos que ya se extrajeron del producto:
 *     en "ASTA TONER CF258 CON CHIP M304a-M404DW…", el CF258 es el cartucho y
 *     las M40x son las impresoras, en la misma línea.
 */

/** Las marcas que sabemos leer. Es la lista de `extraerCartuchos` más Xerox. */
export type MarcaImpresora = 'HP' | 'Canon' | 'Epson' | 'Brother' | 'Samsung' | 'Xerox';

export interface CandidatoImpresora {
  marca: MarcaImpresora;
  /** "LaserJet P3010", "ML-1916": como se guardará en `printer_models.name`. */
  nombre: string;
  nombreNormalizado: string;
  /** El fragmento literal del nombre del que salió, para revisar sin adivinar. */
  evidencia: string;
}

/**
 * Familias de impresora por marca: la palabra que abre el fragmento.
 *
 * Solo van familias, nunca códigos sueltos. El orden importa dentro de cada
 * marca: la primera que coincida abre el fragmento, así que las compuestas
 * ("Smart Tank") van antes que las que las contienen.
 */
const FAMILIAS: Array<{ marca: MarcaImpresora; palabras: string[]; pegada?: true }> = [
  { marca: 'HP', palabras: ['color laserjet', 'laserjet', 'officejet', 'deskjet', 'smart tank', 'neverstop', 'pagewide', 'envy'] },
  { marca: 'Epson', palabras: ['workforce', 'ecotank', 'expression', 'stylus'] },
  { marca: 'Canon', palabras: ['imageclass', 'imagerunner', 'i-sensys', 'isensys', 'maxify', 'pixma'] },
  // Brother escribe la familia pegada al modelo ("HL-L2300D"), así que no es un
  // prefijo que haya que arrastrar: ya viaja dentro de cada nombre.
  { marca: 'Brother', palabras: ['mfc', 'dcp', 'hl'], pegada: true },
  { marca: 'Samsung', palabras: ['proxpress', 'xpress'] },
  { marca: 'Xerox', palabras: ['versalink', 'workcentre', 'phaser'] },
];

/**
 * Códigos que, en tanda, solo pueden ser impresoras.
 *
 * Es la excepción a «hace falta una familia», para los nombres que enumeran
 * modelos sin decir la familia: "ML-1916/1915/1910", "M304a-M404DW-M404N".
 * Cada marca tiene su prefijo y NO se cruzan: una `M404` es de HP y una `MF411`
 * de Canon, y confundirlas manda al cliente al tóner de otra impresora.
 *
 * Hace falta que haya DOS o más en la tanda: un código suelto en mitad de un
 * nombre es casi siempre el cartucho.
 */
const TANDAS: Array<{ marca: MarcaImpresora; patron: RegExp }> = [
  { marca: 'Samsung', patron: /\b(?:ML|SCX|SL-M|CLX|CLP)-?\s?\d{3,4}[A-Z]{0,3}\b/gi },
  { marca: 'HP', patron: /\b[MPE]\d{3,4}[A-Z]{0,4}\b/gi },
  { marca: 'Canon', patron: /\b(?:MF|LBP|IR)-?\s?\d{3,4}[A-Z]{0,3}\b/gi },
  { marca: 'Brother', patron: /\b(?:HL|DCP|MFC)-?\s?[A-Z]?\d{3,4}[A-Z]{0,3}\b/gi },
  // Epson numera sus multifunción "L1110, L3110, L5190", y son cuatro de los
  // veinte productos más vendidos: sin esto, el tramo que más factura queda fuera.
  { marca: 'Epson', patron: /\bL\d{3,4}[A-Z]{0,2}\b/gi },
];

/** Palabras tras las que ya no se está hablando de impresoras. */
const CORTES = /\b(NEGRO|BLACK|CYAN|CIAN|MAGENTA|AMARILLO|YELLOW|COLOR|ORIGINAL|COMPATIBLE|CON CHIP|SIN CHIP|VERSION|PACK|UNIDADES)\b/i;

/**
 * Referencia larga de cartucho: "T544120AL", "C13T544120".
 *
 * Cinco cifras o más es la firma de una referencia de venta, no de un modelo de
 * impresora: las impresoras se numeran con tres o cuatro ("M404dn", "L3110").
 * Sirve de corte cuando el nombre pega la referencia al final de la lista y la
 * palabra de color va con errata, que es justo el caso de "L5190- BLAKC
 * T544120AL".
 */
const REFERENCIA_LARGA = /\b[A-Z]{1,3}\d{5,}[A-Z]{0,3}\b/i;

const MARCA_EN_NOMBRE: Array<{ marca: MarcaImpresora; patron: RegExp }> = [
  { marca: 'HP', patron: /\bHP\b|HEWLETT/i },
  { marca: 'Canon', patron: /\bCANON\b/i },
  { marca: 'Epson', patron: /\bEPSON\b/i },
  { marca: 'Brother', patron: /\bBROTHER\b/i },
  { marca: 'Samsung', patron: /\bSAMSUNG\b/i },
  { marca: 'Xerox', patron: /\bXEROX\b/i },
];

/** La marca que dice el nombre, si lo dice. "ASTA" no es marca de impresora. */
export function marcaDelNombre(nombre: string): MarcaImpresora | null {
  return MARCA_EN_NOMBRE.find((m) => m.patron.test(nombre))?.marca ?? null;
}

/**
 * Desde la familia hasta donde deja de hablarse de impresoras.
 *
 * El fragmento acaba en la primera palabra de corte ("NEGRO", "CON CHIP") o al
 * final del nombre. Lo que va ANTES de la familia no entra: ahí está el código
 * del cartucho.
 */
function fragmentoDesde(nombre: string, desde: number, excluidos: string[]): string {
  let resto = nombre.slice(desde);
  // El parentesis cierra la lista: "CANON TONER 128 (MF4450 / MF4570)".
  const cortes = [resto.search(CORTES), resto.indexOf(')'), resto.search(REFERENCIA_LARGA)].filter((i) => i > 0);
  // Y donde vuelve a hablarse del cartucho, se acabaron las impresoras: en
  // "EPSON TINTA L1110-L3110-L5190- BLAKC T544120AL", el T544 es el cartucho y
  // sin esto se pegaba al ultimo modelo. La errata de "BLAKC" no la salva CORTES.
  for (const codigo of excluidos) {
    if (codigo.length < 3) continue;
    const i = resto.toUpperCase().indexOf(codigo.toUpperCase());
    if (i > 0) cortes.push(i);
  }
  if (cortes.length) resto = resto.slice(0, Math.min(...cortes));
  return resto.trim();
}

/**
 * Dónde empieza la familia de impresora, cuál es su marca y qué palabra la abre.
 *
 * `base` es esa palabra tal como está escrita —"LaserJet", "imageCLASS"—, para
 * arrastrarla a los modelos que no la repiten: sin ella, "Pro M521" se queda en
 * un nombre que no dice de qué es. En las familias pegadas va vacía.
 */
function buscarFamilia(nombre: string): { marca: MarcaImpresora; desde: number; base: string } | null {
  const bajo = nombre.toLowerCase();
  let mejor: { marca: MarcaImpresora; desde: number; base: string } | null = null;
  for (const { marca, palabras, pegada } of FAMILIAS) {
    for (const palabra of palabras) {
      // `hl`, `mfc` y `dcp` de Brother van pegados al modelo ("HL-2350"): como
      // palabra suelta son cualquier cosa. Los demás son palabras enteras.
      const patron = pegada ? new RegExp(`\\b${palabra}\\s?-\\s?[a-z]?\\d`, 'i') : new RegExp(`\\b${palabra.replace(/ /g, '\\s+')}\\b`, 'i');
      const m = bajo.match(patron);
      if (m?.index !== undefined && (mejor === null || m.index < mejor.desde)) {
        mejor = { marca, desde: m.index, base: pegada ? '' : nombre.slice(m.index, m.index + palabra.length) };
      }
    }
  }
  return mejor;
}

/**
 * Dónde empieza la tanda de códigos, y de qué marca es.
 *
 * Gana la marca con más códigos: en "SAMSUNG MLT-D105S ML-1916/1915/1910" la
 * tanda es la de las ML, y el MLT-D105S, que es el cartucho, queda fuera porque
 * empieza más atrás pero no casa con ningún patrón.
 *
 * Solo dice DÓNDE empieza: la enumeración sigue con cifras sueltas ("/1915") que
 * ningún patrón reconoce por su cuenta, y de eso ya sabe `separarModelos`.
 */
function buscarTanda(nombre: string, excluidos: Set<string>): { marca: MarcaImpresora; desde: number } | null {
  let mejor: { marca: MarcaImpresora; desde: number; cuantos: number } | null = null;
  for (const { marca, patron } of TANDAS) {
    const casos = [...nombre.matchAll(patron)].filter((m) => !excluidos.has(normalizarModelo(m[0])));
    if (casos.length === 0) continue;
    if (mejor === null || casos.length > mejor.cuantos) mejor = { marca, desde: casos[0].index!, cuantos: casos.length };
  }
  return mejor ? { marca: mejor.marca, desde: mejor.desde } : null;
}

/**
 * Lo que separa dos modelos, a barra: "M404DN-M404N-MFP M428FDW", "M404 M428".
 *
 * `separarModelos` ya trata el guion entre cifras ("662-663"), pero aquí los
 * códigos empiezan por letra y ahí el guion es ambiguo: en "ML-1916" es parte
 * del modelo. Se convierte solo entre dos códigos, y por eso el lado izquierdo
 * tiene que empezar por letra: "LaserJet 1010/1012 M1005" no se toca.
 */
const separadoresABarra = (texto: string) =>
  texto
    .replace(/([A-Za-z]\d{3,4}[A-Za-z]{0,4})[\s-]+(?=[A-Za-z]{1,4}\s?[A-Za-z]?\d)/g, '$1/')
    // Una cifra suelta seguida de otro codigo son dos modelos, no uno: en
    // "ML-2166/2168 SCX-3400" el 2168 es una ML y la SCX es otra impresora.
    .replace(/\b(\d{3,4})\s+(?=[A-Za-z]{1,4}-?\d)/g, '$1/');

/**
 * Impresoras que menciona el nombre de un producto.
 *
 * `codigosCartucho` son los cartuchos que ya se extrajeron de ese mismo producto:
 * lo que sea uno de ellos no puede ser una impresora. Sin esa lista se sigue
 * funcionando, pero se propone peor.
 */
export function extraerImpresoras(nombre: string, codigosCartucho: string[] = []): CandidatoImpresora[] {
  const excluidos = new Set(codigosCartucho.map(normalizarModelo).filter(Boolean));

  // La familia manda sobre la tanda: dice la marca sin depender de que el nombre
  // la escriba, y marca dónde acaba el código del cartucho y empiezan las
  // impresoras. Sin familia, la tanda, que exige DOS modelos para no confundir
  // un cartucho suelto con una impresora.
  const familia = buscarFamilia(nombre);
  const tanda = familia ? null : buscarTanda(nombre, excluidos);
  if (!familia && !tanda) return [];

  const marca = familia?.marca ?? tanda!.marca;
  const desde = familia?.desde ?? tanda!.desde;
  const texto = fragmentoDesde(nombre, desde, [...excluidos, ...codigosCartucho]);
  const base = familia?.base ?? '';

  const { modelos } = separarModelos(separadoresABarra(texto), marca);
  if (!familia && modelos.length < 2) return [];

  const vistos = new Set<string>();
  const candidatos: CandidatoImpresora[] = [];
  for (const crudo of modelos) {
    // El guion o la coma que quedan al final son del nombre del producto, no del
    // modelo: "L5190-" es la L5190.
    const m = crudo.replace(/[\s\-/,.;:]+$/, '');
    const completo = base && !normalizarModelo(m).startsWith(normalizarModelo(base)) ? `${base} ${m}` : m;
    const normalizado = normalizarModelo(completo);
    if (!normalizado || excluidos.has(normalizado) || vistos.has(normalizado)) continue;
    vistos.add(normalizado);
    candidatos.push({ marca, nombre: completo, nombreNormalizado: normalizado, evidencia: texto.slice(0, 255) });
  }
  return candidatos;
}
