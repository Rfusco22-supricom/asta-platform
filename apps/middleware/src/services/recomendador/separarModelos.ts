import { normalizarModelo } from './normalizar.js';

/**
 * Del texto libre de `compatibilidad_productos.modelo` a modelos de impresora
 * sueltos (#56).
 *
 * La tabla la escribe una persona en phpMyAdmin, y cada fila lo escribe a su
 * manera. Medido sobre las 85 filas de producción:
 *
 *   "HP: M208, M209, M211"                           etiqueta y comas
 *   "HP LaserJet 1010/1012/1015/…/M1319f/M1005"      familia y barras
 *   "HP M125/M127/M201/225"                          prefijo que se hereda: 225 → M225
 *   "Canon I-SENSYS LBP662-663-664"                  guiones entre modelos
 *   "ML-1916/1915/1910"                              guion DENTRO del modelo
 *   "HP M154/M180/M181 (negro)"                      anotación entre paréntesis
 *   "HP LaserJet Pro M404/HP LaserJet Pro MFP M428"  nombres completos separados por barra
 *
 * ── Lo que NO intenta ────────────────────────────────────────────────────────
 *
 * Corregir el texto. «P560/P566/…» en la fila del CE278A son casi seguro
 * P1560/P1566 con el «1» perdido, pero adivinarlo convertiría un error visible en
 * uno invisible. Se separa lo que dice, y todo lo importado entra como PROPUESTA
 * para que una persona lo revise con el texto original al lado.
 */

export interface ModelosSeparados {
  /** Nombres tal como se guardarán en `printer_models.name`, sin la marca. */
  modelos: string[];
  /** El color, si la fila lo anota entre paréntesis: "(negro)". */
  color: string | null;
}

const COLORES: Record<string, string> = {
  negro: 'negro',
  black: 'negro',
  bk: 'negro',
  cyan: 'cian',
  cian: 'cian',
  amarillo: 'amarillo',
  yellow: 'amarillo',
  magenta: 'magenta',
};

/**
 * "HP:", "HP COLOR:", "Canon", "Samsung" al principio: no forman parte del modelo.
 *
 * «COLOR» solo se quita como etiqueta, con los dos puntos: en «HP Color LaserJet
 * Pro M254» es parte del nombre de la familia.
 */
function sinMarca(texto: string, marca: string): string {
  const m = marca.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return texto.replace(new RegExp(`^\\s*${m}\\b(\\s+color\\s*:|\\s*:)?\\s*`, 'i'), '').trim();
}

const tieneDigito = (s: string) => /\d/.test(s);

/**
 * Las letras con las que empieza un código de modelo, para heredarlas:
 * "MF4680" → "MF", "ML-1916" → "ML-", "LBP662" → "LBP", "1010" → "".
 */
function prefijoDe(codigo: string): string {
  return codigo.match(/^[A-Za-z]+-?/)?.[0] ?? '';
}

/**
 * Un trozo entre separadores: palabras de familia y un código al final.
 * "HP LaserJet Pro MFP M428" → { familia: "LaserJet Pro MFP", codigo: "M428" }.
 * El código es la ÚLTIMA palabra con cifras: en "LaserJet pro 200 color M251",
 * el modelo es M251.
 */
function trozo(texto: string, marca: string): { familia: string | null; codigo: string } | null {
  const palabras = sinMarca(texto, marca).split(/\s+/).filter(Boolean);
  let i = palabras.length - 1;
  while (i >= 0 && !tieneDigito(palabras[i])) i--;
  if (i < 0) return null;
  const familia = palabras.slice(0, i).join(' ');
  return { familia: familia || null, codigo: palabras[i] };
}

export function separarModelos(texto: string, marca: string): ModelosSeparados {
  let color: string | null = null;
  // Paréntesis: el color se guarda; lo demás ("(414)") se descarta.
  const limpio = texto.replace(/\(([^)]*)\)/g, (_, dentro: string) => {
    const c = COLORES[dentro.trim().toLowerCase()];
    if (c) color = c;
    return ' ';
  });

  const modelos: string[] = [];
  const vistos = new Set<string>();
  const anadir = (nombre: string) => {
    const n = nombre.replace(/\s+/g, ' ').trim();
    const clave = normalizarModelo(n);
    // Sin cifras no es un modelo: "LaserJet Pro" es una familia entera.
    if (!clave || !tieneDigito(clave) || vistos.has(clave)) return;
    vistos.add(clave);
    modelos.push(n);
  };

  // Las comas separan grupos que no comparten familia ni prefijo.
  for (const grupo of sinMarca(limpio, marca).split(',')) {
    // Guion entre dos grupos de cifras = separador ("662-663"); pegado a letras
    // es parte del modelo ("ML-1916", "WF-C5310").
    const partes = grupo.replace(/(\d[A-Za-z]*)-(?=\d)/g, '$1/').split('/');

    let familia: string | null = null;
    let prefijo = '';
    for (const parte of partes) {
      const t = trozo(parte, marca);
      if (!t) continue;
      if (t.familia !== null) {
        // Una "familia" que es solo un número es una SERIE de la familia anterior:
        // en "LaserJet Pro 300/400 M351", el 400 va con "LaserJet Pro".
        familia = /^\d+$/.test(t.familia) && familia ? `${familia.replace(/\s+\d+$/, '')} ${t.familia}` : t.familia;
      }

      let codigo = t.codigo;
      // "225" tras "M201" es la M225. Solo si el trozo es cifras sueltas.
      if (/^\d/.test(codigo) && t.familia === null && prefijo) codigo = prefijo + codigo;
      else prefijo = prefijoDe(codigo);

      anadir(familia ? `${familia} ${codigo}` : codigo);
    }
  }

  return { modelos, color };
}

/**
 * Código de cartucho de la tabla → formas con las que puede estar en
 * `cartridges.code_normalized`. La primera es la exacta.
 *
 * Canon escribe "CRG055" en la tabla y "055" en los nombres de Odoo, de donde el
 * importador de productos sacó el cartucho. Solo se prueba sin el prefijo; NO se
 * quita el color ("CRG055BK" no es "055"): el cartucho negro y el cian son
 * productos distintos, y juntarlos le vendería al cliente el que no es.
 */
export function formasDelCodigo(codigo: string, marca: string): string[] {
  const n = normalizarModelo(codigo);
  const formas = [n];
  if (marca.trim().toLowerCase() === 'canon' && n.startsWith('crg') && n.length > 3) formas.push(n.slice(3));
  return formas;
}
