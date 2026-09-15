import { normalizarCodigoCartucho } from './normalizar.js';

/**
 * Qué cartucho es un producto de Odoo, leído de su nombre y su referencia (#56).
 *
 * Es la mitad "producto ↔ cartucho" del esquema de #101. La otra mitad
 * —cartucho ↔ impresora— sale de las tablas de los fabricantes.
 *
 * ── Por qué del NOMBRE ───────────────────────────────────────────────────────
 *
 * El `default_code` de los consumibles más vendidos es el número de pieza del
 * fabricante, no el cartucho: `8274B001AA` es el PG-145 XL de Canon, `3YM79AL`
 * el 667 de HP. El cartucho está escrito en el nombre. Del `default_code` solo
 * se aprovecha lo que sí es un código de cartucho: los de HP (`W1105A`,
 * `CF258A`), Epson (`T544120-AL` → T544) y los ASTA (`A-TN-920UXXL`).
 *
 * ── Qué promete ──────────────────────────────────────────────────────────────
 *
 * CANDIDATOS, no verdades. Todo lo que sale de aquí entra en `product_cartridges`
 * con `status = PROPUESTA` y lo valida una persona antes de que el kiosco lo use:
 * #56 lo exige, porque un falso positivo le vende al cliente un tóner que no le
 * sirve. Por eso prima no perder códigos sobre no proponer de más, y cada
 * candidato lleva la `evidencia`: el fragmento exacto del que salió, para que la
 * revisión sea mirar y confirmar.
 */

export type MarcaCartucho = 'HP' | 'Canon' | 'Epson' | 'Brother' | 'Samsung';

export interface CandidatoCartucho {
  marca: MarcaCartucho;
  /** Forma canónica: "PG-145XL", "667XL", "T544", "TN-227C". */
  codigo: string;
  codigoNormalizado: string;
  /** El fragmento literal del nombre o de la referencia. */
  evidencia: string;
}

interface Regla {
  marca: MarcaCartucho;
  patron: RegExp;
  /** De la coincidencia a la forma canónica. */
  canonico: (m: RegExpMatchArray) => string;
  /** Solo si el producto es de esta marca (o ASTA que la menciona). */
  exigeMarca: boolean;
  /** No se aplica a productos cuyo nombre cumpla esto. */
  noEn?: RegExp;
}

const sinEspacios = (s: string) => s.replace(/\s+/g, '').toUpperCase();

const REGLAS: Regla[] = [
  // ── HP ── Códigos de pieza que SON el cartucho, en cualquier producto.
  // Sufijo opcional de contrato (C) o de paquete (D): "W2023XC", "CF217AC", "CE285AD".
  // Son el mismo cartucho a efectos de compatibilidad, así que no entran en el código.
  { marca: 'HP', exigeMarca: false, patron: /\b((?:W\d{4}|CF\d{3}|CE\d{3}|CB\d{3}|Q\d{4})[AXY]?)[CD]?\b/gi, canonico: (m) => m[1].toUpperCase() },
  // Número comercial: "667", "667XL", "954 XL", "105A", "26A", "151X", "GT53".
  // Nunca pegado a un guion: en "CRG-047" o "LQ-590" el número es de otra cosa.
  // Y no en cabezales: sus números ("SM 100, 300, 400") son series de impresora.
  { marca: 'HP', exigeMarca: true, patron: /\b(GT\s?5\d)(?:BK|C|M|Y)?\b/gi, canonico: (m) => sinEspacios(m[1]) },
  { marca: 'HP', exigeMarca: true, patron: /(?<!-)\b(\d{2,3}(?:[AXY]|\s?XL)?)[CD]?\b(?!\s?ml)/gi, canonico: (m) => sinEspacios(m[1]), noEn: /CABEZAL|PRINTHEAD/i },

  // ── Canon ──
  // "PG-145 XL", "GI-16", "GPR-58", "BH-10", "PGI-250", "CLI-251". El color pegado
  // ("PFI-050BK") no forma parte del cartucho a efectos de compatibilidad.
  { marca: 'Canon', exigeMarca: true, patron: /\b((?:PGI|CLI|PG|CL|GI|GPR|PFI|BH|CH)\s?-?\s?\d{1,3})(\s?XL)?(?:BK|PBK|MBK|GY|C|M|Y)?\b/gi, canonico: (m) => `${m[1].replace(/[\s-]/g, '').replace(/^([A-Z]+)/i, '$1-').toUpperCase()}${m[2] ? 'XL' : ''}` },
  { marca: 'Canon', exigeMarca: true, patron: /\b(T\d{2})\b/g, canonico: (m) => m[1] },
  // "CRG 057H", "CRG-070H", "TONER 067 H", "TONER 125".
  // "CRG" solo lo usa Canon: no hace falta que el nombre diga CANON ("ASTA TONER CRG-055BK").
  { marca: 'Canon', exigeMarca: false, patron: /\bCRG\s?[-.]?\s?(\d{3})(\s?H)?(?:BK|C|M|Y)?\b/gi, canonico: (m) => `${m[1]}${m[2] ? 'H' : ''}` },
  { marca: 'Canon', exigeMarca: true, patron: /\bTONER\s(\d{3})(\s?H)?\b/gi, canonico: (m) => `${m[1]}${m[2] ? 'H' : ''}` },
  // "CANON 054 YELLOW", "CANON 075H": tres cifras empezando por 0, sin TONER delante.
  { marca: 'Canon', exigeMarca: true, patron: /(?<!-)\b(0\d{2})(\s?H)?\b/g, canonico: (m) => `${m[1]}${m[2] ? 'H' : ''}` },

  // ── Epson ──
  // "T544", "T504", "T11A", "T40W", "T49M", y en la referencia "T544120-AL".
  { marca: 'Epson', exigeMarca: true, patron: /\b(T\d{2}[0-9A-Z])(?:\d{3})?(?:-\w+)?\b/gi, canonico: (m) => m[1].toUpperCase() },
  // Número comercial: "748XXL", "673", "664", y con el color pegado en las
  // referencias ASTA ("A-664BK"), que sin quitar el prefijo quedarían tapadas por el guion.
  { marca: 'Epson', exigeMarca: true, patron: /(?<!-)\b(\d{3}(?:XXL|XL)?)(?:BK|C|M|Y)?\b(?!\s?ml)/gi, canonico: (m) => m[1].toUpperCase() },

  // ── Brother ──
  { marca: 'Brother', exigeMarca: false, patron: /\b((?:TN|DR)\s?-?\s?\d{3,4}[A-Z]*)\b/gi, canonico: (m) => m[1].replace(/[\s-]/g, '').replace(/^(TN|DR)/i, '$1-').toUpperCase() },

  // ── Samsung ──
  { marca: 'Samsung', exigeMarca: false, patron: /\b(MLT-?D\d{3}[A-Z]?)\b/gi, canonico: (m) => m[1].replace(/^MLT-?/i, 'MLT-').toUpperCase() },
];

/** Marcas que menciona el texto. Los ASTA dicen de quién es el cartucho: "ASTA TONER CANON T03". */
function marcasMencionadas(texto: string): Set<MarcaCartucho> {
  const t = texto.toUpperCase();
  const marcas = new Set<MarcaCartucho>();
  if (/\bHP\b|LASERJET|DESKJET/.test(t)) marcas.add('HP');
  if (/\bCANON\b|PIXMA|IMAGECLASS/.test(t)) marcas.add('Canon');
  if (/\bEPSON\b|ECOTANK/.test(t)) marcas.add('Epson');
  if (/\bBROTHER\b/.test(t)) marcas.add('Brother');
  if (/\bSAMSUNG\b/.test(t)) marcas.add('Samsung');
  return marcas;
}

/**
 * La referencia sin el prefijo de la marca propia: "A-TN-920UXXL" → "TN-920UXXL".
 * Los ASTA llevan el código del cartucho que sustituyen detrás de "A-".
 */
function referenciaUtil(defaultCode: string | null): string {
  return (defaultCode ?? '').replace(/^A-/i, '');
}

export function extraerCartuchos(nombre: string, defaultCode: string | null): CandidatoCartucho[] {
  const marcas = marcasMencionadas(nombre);
  const encontrados = new Map<string, CandidatoCartucho>();

  for (const [texto, esReferencia] of [[nombre, false], [referenciaUtil(defaultCode), true]] as const) {
    if (!texto) continue;
    for (const regla of REGLAS) {
      if (regla.exigeMarca && !marcas.has(regla.marca)) continue;
      if (regla.noEn?.test(nombre)) continue;
      // El número comercial de HP no se busca en la referencia: "3YM79AL" no es el 79.
      if (esReferencia && regla.marca === 'HP' && regla.exigeMarca) continue;
      for (const m of texto.matchAll(regla.patron)) {
        const codigo = regla.canonico(m);
        const clave = `${regla.marca}:${normalizarCodigoCartucho(codigo)}`;
        if (!encontrados.has(clave)) {
          encontrados.set(clave, { marca: regla.marca, codigo, codigoNormalizado: normalizarCodigoCartucho(codigo), evidencia: m[0].trim() });
        }
      }
    }
  }

  return [...encontrados.values()];
}
