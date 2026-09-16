/**
 * La búsqueda de #38 TAL COMO ERA antes de optimizarla, sin tocar una línea salvo
 * este comentario y la ruta del import. Referencia de
 * `buscarModelosEquivalencia.test.ts`: la versión rápida tiene que dar
 * exactamente lo mismo. No se usa fuera de los tests.
 */
import { normalizarModelo } from '../../services/recomendador/normalizar.js';

/**
 * Búsqueda difusa de modelos de impresora (#38).
 *
 * Criterio de aceptación del issue: *10 variantes tipeadas a mano del mismo
 * modelo encuentran la impresora correcta*. Y, tan importante como eso aunque el
 * issue no lo diga: **no encuentran otra**. Un recomendador que responde a
 * "hl2350" con la HL-L2370DW le vende al cliente un tóner que no le sirve, y lo
 * hace delante de él en piso de venta.
 *
 * ── Por qué en memoria y no en MySQL ─────────────────────────────────────────
 *
 * El issue sugería trigramas con `pg_trgm`, pero la base es MySQL y no los
 * tiene. El catálogo de impresoras son unos miles de modelos: cabe entero en
 * memoria, y así la regla de búsqueda es una función pura con tests, no una
 * consulta SQL que solo se puede probar contra la base.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * Lo que identifica un modelo son sus NÚMEROS. "HL-L2350DW" y "HL-L2370DW" solo
 * se distinguen por 2350 y 2370, y por eso una coincidencia parcial exige que
 * los números de la búsqueda aparezcan tal cual. Las letras se toleran más: la
 * gente se come la L de "HL-L", o el sufijo "DW".
 *
 * Por niveles, de más a menos fiable:
 *
 *   100  la búsqueda ES el nombre o un alias
 *    90  el nombre o un alias CONTIENE la búsqueda          "l2350dw"
 *    85  la búsqueda CONTIENE el nombre o un alias          "brother hl-l2350dw"
 *    80  mismos números, y las letras en el mismo orden     "hl2350"
 *
 * Si nada llega a 80, no hay coincidencias sino SUGERENCIAS ("quisiste
 * decir"): los modelos más parecidos por distancia de edición. Se devuelven
 * aparte a propósito, para que la interfaz pregunte en vez de afirmar.
 */

export interface ModeloBuscable {
  id: number;
  nombre: string;
  marca: string;
  aliases: string[];
}

export interface Coincidencia {
  id: number;
  nombre: string;
  marca: string;
  puntuacion: number;
}

export interface ResultadoBusqueda {
  coincidencias: Coincidencia[];
  /** Solo cuando no hay coincidencias. */
  sugerencias: Coincidencia[];
}

/** Por debajo de esto, un parecido no se ofrece ni como sugerencia. */
export const SIMILITUD_MINIMA_SUGERENCIA = 0.7;
const MAX_SUGERENCIAS = 5;
/** Una clave más corta que esto no se busca DENTRO de la consulta: "m4" está en demasiadas. */
const LONGITUD_MINIMA_CONTENIDA = 4;

const numeros = (s: string): string[] => s.match(/\d+/g) ?? [];
const letras = (s: string): string => s.replace(/\d/g, '');

function esSubsecuencia(aguja: string, pajar: string): boolean {
  let i = 0;
  for (const c of pajar) if (c === aguja[i]) i++;
  return i === aguja.length;
}

/**
 * Distancia de Damerau-Levenshtein (versión OSA): cuenta la transposición de dos
 * caracteres contiguos como UN error. "2530" por "2350" es el typo típico, y
 * con Levenshtein simple costaría dos.
 */
export function distanciaEdicion(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + coste);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function similitudEntera(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - distanciaEdicion(a, b) / max;
}

/**
 * Parecido entre la consulta y la PARTE de la clave que más se le parece.
 *
 * Comparar "m40dn" con "laserjetprom404dn" entero da una similitud bajísima,
 * aunque el cliente solo se comió un 4: la diferencia de longitud se come la
 * puntuación. Se compara contra cada fragmento de la clave de la longitud de la
 * consulta, uno más y uno menos.
 */
function similitud(consulta: string, clave: string): number {
  let mejor = similitudEntera(consulta, clave);
  if (clave.length <= consulta.length + 1) return mejor;
  for (let largo = Math.max(1, consulta.length - 1); largo <= consulta.length + 1; largo++) {
    for (let i = 0; i + largo <= clave.length; i++) {
      mejor = Math.max(mejor, similitudEntera(consulta, clave.slice(i, i + largo)));
    }
  }
  return mejor;
}

function puntuar(consulta: string, clave: string): number {
  if (consulta === clave) return 100;
  if (clave.includes(consulta)) return 90;
  if (clave.length >= LONGITUD_MINIMA_CONTENIDA && consulta.includes(clave)) return 85;

  const nc = numeros(consulta);
  if (nc.length > 0) {
    const nk = numeros(clave);
    const mismosNumeros = nc.every((n) => nk.includes(n));
    if (mismosNumeros && esSubsecuencia(letras(consulta), letras(clave))) return 80;
  }
  return 0;
}

/** Las formas de la consulta a probar: tal cual, y sin la marca delante. */
function variantesDeConsulta(consulta: string, marcas: Set<string>): string[] {
  const variantes = [consulta];
  for (const marca of marcas) {
    if (marca && consulta.startsWith(marca) && consulta.length > marca.length) {
      variantes.push(consulta.slice(marca.length));
    }
  }
  return variantes;
}

/**
 * Con qué se compara la consulta: el nombre, los aliases y, además, cada PALABRA
 * del nombre que lleva números.
 *
 * Esto último es por el orden: "l3150 ecotank" no contiene "ecotankl3150" ni
 * sus letras van en el mismo orden, pero sí contiene "l3150", que es lo que
 * identifica la impresora. Solo palabras con números: "ecotank" o "laserjet"
 * son familias enteras, no modelos.
 */
function clavesDe(modelo: ModeloBuscable): string[] {
  const palabrasConNumero = modelo.nombre
    .split(/\s+/)
    .map(normalizarModelo)
    .filter((p) => /\d/.test(p));
  return [...new Set([modelo.nombre, ...modelo.aliases].map(normalizarModelo).concat(palabrasConNumero))].filter(Boolean);
}

export function buscarModelos(consulta: string, catalogo: ModeloBuscable[]): ResultadoBusqueda {
  const q = normalizarModelo(consulta);
  // Con menos de dos caracteres cualquier cosa coincide con todo.
  if (q.length < 2) return { coincidencias: [], sugerencias: [] };

  const marcas = new Set(catalogo.map((m) => normalizarModelo(m.marca)));
  // Una marca sola no es un modelo.
  if (marcas.has(q)) return { coincidencias: [], sugerencias: [] };
  const variantes = variantesDeConsulta(q, marcas);

  const coincidencias: Coincidencia[] = [];
  const candidatasASugerencia: Coincidencia[] = [];

  for (const modelo of catalogo) {
    const claves = clavesDe(modelo);
    const marca = normalizarModelo(modelo.marca);

    let mejor = 0;
    let parecido = 0;
    for (const v of variantes) {
      for (const clave of claves) {
        mejor = Math.max(mejor, puntuar(v, clave));
        parecido = Math.max(parecido, similitud(v, clave));
      }
      // La marca delante, sin separar ("brotherhll2350dw"). Solo si la consulta
      // es MÁS que la marca: "brother" a secas no afirma ninguna impresora.
      if (v.length > marca.length) mejor = Math.max(mejor, ...claves.map((c) => puntuar(v, marca + c)));
    }

    const fila = { id: modelo.id, nombre: modelo.nombre, marca: modelo.marca, puntuacion: mejor };
    if (mejor >= 80) coincidencias.push(fila);
    else if (parecido >= SIMILITUD_MINIMA_SUGERENCIA) candidatasASugerencia.push({ ...fila, puntuacion: Math.round(parecido * 100) });
  }

  const orden = (a: Coincidencia, b: Coincidencia) => b.puntuacion - a.puntuacion || a.nombre.length - b.nombre.length || a.id - b.id;

  if (coincidencias.length > 0) return { coincidencias: coincidencias.sort(orden), sugerencias: [] };
  return { coincidencias: [], sugerencias: candidatasASugerencia.sort(orden).slice(0, MAX_SUGERENCIAS) };
}
