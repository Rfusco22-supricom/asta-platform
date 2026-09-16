import { normalizarModelo } from './normalizar.js';

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

/**
 * ── Coste ────────────────────────────────────────────────────────────────────
 *
 * Esta función corre en el hilo de Node, en un endpoint público (#39) que el
 * kiosco llamará en cada tecla: mientras busca, no atiende a NADIE, panel de
 * vendedores incluido. Con 3.000 modelos tardaba 100–265 ms y con 10.000 hasta
 * 1,2 s. Tres cosas lo bajan sin cambiar un solo resultado —lo comprueba
 * `buscarModelosEquivalencia.test.ts` contra la versión anterior—:
 *
 *   · el parecido de edición, lo caro, solo se calcula si NADA coincide: con
 *     alguna coincidencia las sugerencias se descartan igual
 *   · las claves normalizadas de cada modelo se preparan una vez por catálogo
 *     (`WeakMap` sobre el array: el servicio reutiliza el mismo mientras dura
 *     su cache), no en cada búsqueda
 *   · la distancia de edición usa tres filas reutilizadas y recorre la clave por
 *     posiciones, sin reservar matrices ni cortar subcadenas
 *   · una clave que no PUEDE llegar al umbral de sugerencia no se mide (ver
 *     `cotaDeParecido`)
 */

interface Partida {
  texto: string;
  numeros: string[];
  letras: string;
  /** Cuántas veces sale cada carácter, a–z y 0–9: el texto ya está normalizado. */
  cuenta: Uint8Array;
}

function contar(texto: string): Uint8Array {
  const cuenta = new Uint8Array(36);
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    const k = c >= 97 ? c - 97 : c - 48 + 26;
    if (k >= 0 && k < 36 && cuenta[k] < 255) cuenta[k]++;
  }
  return cuenta;
}

const partir = (texto: string): Partida => ({ texto, numeros: texto.match(/\d+/g) ?? [], letras: texto.replace(/\d/g, ''), cuenta: contar(texto) });

/**
 * Lo MÁS parecida que puede llegar a ser la consulta a la clave o a un trozo de
 * ella, sin medirlo. Sirve para no calcular distancias que no pueden llegar al
 * umbral; nunca descarta una clave que llegaría.
 *
 * Cada operación de edición elimina a lo sumo UN carácter de la consulta que la
 * clave no tiene (borrar o sustituir; transponer no elimina ninguno). Si a la
 * consulta le `sobran` caracteres que no están en la clave, tampoco están en
 * ningún trozo suyo: cualquier distancia es al menos `sobran`. El parecido es
 * `1 - distancia / max(longitudes)`, y el mayor denominador posible es el de la
 * clave entera o el de un trozo de la longitud de la consulta más uno.
 */
function cotaDeParecido(consulta: Partida, clave: Partida): number {
  let sobran = 0;
  for (let k = 0; k < 36; k++) if (consulta.cuenta[k] > clave.cuenta[k]) sobran += consulta.cuenta[k] - clave.cuenta[k];
  return 1 - sobran / Math.max(consulta.texto.length + 1, clave.texto.length);
}

/** Para que un redondeo de coma flotante no descarte un empate exacto con el umbral. */
const MARGEN_COTA = 1e-9;

function esSubsecuencia(aguja: string, pajar: string): boolean {
  let i = 0;
  for (const c of pajar) if (c === aguja[i]) i++;
  return i === aguja.length;
}

// Tres filas de la matriz de distancias, reutilizadas entre llamadas. Node
// ejecuta esto en un solo hilo y la función no cede el control a mitad.
let dosAtras = new Int32Array(64);
let anterior = new Int32Array(64);
let actual = new Int32Array(64);

/** Distancia entre `a` y `b.slice(desde, desde + largo)`, sin crear la subcadena. */
function distancia(a: string, b: string, desde: number, largo: number): number {
  if (anterior.length <= largo) {
    const n = (largo + 1) * 2;
    dosAtras = new Int32Array(n);
    anterior = new Int32Array(n);
    actual = new Int32Array(n);
  }
  for (let j = 0; j <= largo; j++) anterior[j] = j;
  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= largo; j++) {
      const bj = b.charCodeAt(desde + j - 1);
      let v = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(desde + j - 2) && a.charCodeAt(i - 2) === bj) {
        v = Math.min(v, dosAtras[j - 2] + 1);
      }
      actual[j] = v;
    }
    const rotar = dosAtras;
    dosAtras = anterior;
    anterior = actual;
    actual = rotar;
  }
  return anterior[largo];
}

/**
 * Distancia de Damerau-Levenshtein (versión OSA): cuenta la transposición de dos
 * caracteres contiguos como UN error. "2530" por "2350" es el typo típico, y
 * con Levenshtein simple costaría dos.
 */
export function distanciaEdicion(a: string, b: string): number {
  return distancia(a, b, 0, b.length);
}

function similitudEntera(a: string, b: string, desde = 0, largo = b.length): number {
  const max = Math.max(a.length, largo);
  return max === 0 ? 1 : 1 - distancia(a, b, desde, largo) / max;
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
      mejor = Math.max(mejor, similitudEntera(consulta, clave, i, largo));
      if (mejor === 1) return 1;
    }
  }
  return mejor;
}

function puntuar(consulta: Partida, clave: Partida): number {
  if (consulta.texto === clave.texto) return 100;
  if (clave.texto.includes(consulta.texto)) return 90;
  if (clave.texto.length >= LONGITUD_MINIMA_CONTENIDA && consulta.texto.includes(clave.texto)) return 85;

  if (consulta.numeros.length > 0) {
    const mismosNumeros = consulta.numeros.every((n) => clave.numeros.includes(n));
    if (mismosNumeros && esSubsecuencia(consulta.letras, clave.letras)) return 80;
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

interface ModeloPreparado {
  modelo: ModeloBuscable;
  marca: string;
  claves: Partida[];
  /** La marca pegada delante de cada clave: "brotherhll2350dw". */
  conMarca: Partida[];
}

interface CatalogoPreparado {
  marcas: Set<string>;
  modelos: ModeloPreparado[];
}

/**
 * Por identidad del array. Quien MODIFIQUE un catálogo en su sitio después de
 * buscar en él verá resultados viejos: hay que pasar un array nuevo, que es lo
 * que hace `recomendador.service.ts` al renovar su cache.
 */
const preparados = new WeakMap<ModeloBuscable[], CatalogoPreparado>();

function preparar(catalogo: ModeloBuscable[]): CatalogoPreparado {
  const hecho = preparados.get(catalogo);
  if (hecho) return hecho;
  const listo: CatalogoPreparado = {
    marcas: new Set(catalogo.map((m) => normalizarModelo(m.marca))),
    modelos: catalogo.map((modelo) => {
      const marca = normalizarModelo(modelo.marca);
      const claves = clavesDe(modelo);
      return { modelo, marca, claves: claves.map(partir), conMarca: claves.map((c) => partir(marca + c)) };
    }),
  };
  preparados.set(catalogo, listo);
  return listo;
}

export function buscarModelos(consulta: string, catalogo: ModeloBuscable[]): ResultadoBusqueda {
  const q = normalizarModelo(consulta);
  // Con menos de dos caracteres cualquier cosa coincide con todo.
  if (q.length < 2) return { coincidencias: [], sugerencias: [] };

  const { marcas, modelos } = preparar(catalogo);
  // Una marca sola no es un modelo.
  if (marcas.has(q)) return { coincidencias: [], sugerencias: [] };
  const variantes = variantesDeConsulta(q, marcas).map(partir);

  const orden = (a: Coincidencia, b: Coincidencia) => b.puntuacion - a.puntuacion || a.nombre.length - b.nombre.length || a.id - b.id;
  const fila = (m: ModeloBuscable, puntuacion: number): Coincidencia => ({ id: m.id, nombre: m.nombre, marca: m.marca, puntuacion });

  // ── Coincidencias ───────────────────────────────────────────────────────────
  const coincidencias: Coincidencia[] = [];
  for (const { modelo, marca, claves, conMarca } of modelos) {
    let mejor = 0;
    for (const v of variantes) {
      for (const clave of claves) mejor = Math.max(mejor, puntuar(v, clave));
      // La marca delante, sin separar ("brotherhll2350dw"). Solo si la consulta
      // es MÁS que la marca: "brother" a secas no afirma ninguna impresora.
      if (v.texto.length > marca.length) for (const c of conMarca) mejor = Math.max(mejor, puntuar(v, c));
    }
    if (mejor >= 80) coincidencias.push(fila(modelo, mejor));
  }
  if (coincidencias.length > 0) return { coincidencias: coincidencias.sort(orden), sugerencias: [] };

  // ── Sugerencias: solo si nada coincide ─────────────────────────────────────
  const candidatas: Coincidencia[] = [];
  for (const { modelo, claves } of modelos) {
    let parecido = 0;
    for (const v of variantes) {
      for (const clave of claves) {
        if (cotaDeParecido(v, clave) < SIMILITUD_MINIMA_SUGERENCIA - MARGEN_COTA) continue;
        parecido = Math.max(parecido, similitud(v.texto, clave.texto));
        if (parecido === 1) break;
      }
    }
    if (parecido >= SIMILITUD_MINIMA_SUGERENCIA) candidatas.push(fila(modelo, Math.round(parecido * 100)));
  }
  return { coincidencias: [], sugerencias: candidatas.sort(orden).slice(0, MAX_SUGERENCIAS) };
}
