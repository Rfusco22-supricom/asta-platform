/**
 * Lector de CSV para los archivos que la gente edita a mano (#56).
 *
 * No hace falta una librería, pero sí cubrir lo que hace Excel de verdad:
 *
 *   · En configuración regional española, "Guardar como CSV" usa `;`, no `,`.
 *     El separador se deduce de la cabecera.
 *   · Añade un BOM (U+FEFF) al principio.
 *   · Entrecomilla los campos con separador, comillas o saltos de línea, y
 *     duplica las comillas internas (`""`).
 *   · Termina las líneas en `\r\n`.
 */

export interface FilaCsv {
  /** Línea del archivo donde EMPIEZA la fila, contando la cabecera como 1. Para los errores. */
  linea: number;
  campos: Record<string, string>;
}

function separadorDe(cabecera: string): ',' | ';' {
  // La cabecera no lleva comillas con separadores dentro: contar basta.
  return (cabecera.match(/;/g)?.length ?? 0) > (cabecera.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** Filas crudas: arrays de campos, con el número de línea donde empieza cada una. */
function filasCrudas(texto: string, sep: string): Array<{ linea: number; campos: string[] }> {
  const filas: Array<{ linea: number; campos: string[] }> = [];
  let campos: string[] = [];
  let campo = '';
  let enComillas = false;
  let linea = 1;
  let inicioFila = 1;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        if (c === '\n') linea++;
        campo += c;
      }
      continue;
    }
    if (c === '"' && campo === '') enComillas = true;
    else if (c === sep) {
      campos.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      campos.push(campo);
      filas.push({ linea: inicioFila, campos });
      campos = [];
      campo = '';
      linea++;
      inicioFila = linea;
    } else campo += c;
  }
  if (campo !== '' || campos.length > 0) {
    campos.push(campo);
    filas.push({ linea: inicioFila, campos });
  }
  if (enComillas) throw new Error(`CSV mal formado: comillas sin cerrar en la fila que empieza en la línea ${inicioFila}`);
  return filas;
}

export function leerCsv(texto: string): FilaCsv[] {
  const limpio = texto.replace(/^\uFEFF/, '');
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = separadorDe(primeraLinea);
  const [cabecera, ...resto] = filasCrudas(limpio, sep);
  if (!cabecera) return [];

  const columnas = cabecera.campos.map((c) => c.trim().toLowerCase());
  return resto
    .filter((f) => f.campos.some((c) => c.trim() !== '')) // líneas vacías al final
    .map((f) => ({
      linea: f.linea,
      campos: Object.fromEntries(columnas.map((col, i) => [col, (f.campos[i] ?? '').trim()])),
    }));
}
