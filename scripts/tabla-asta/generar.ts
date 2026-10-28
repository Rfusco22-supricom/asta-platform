/**
 * Del JSON de `extraer.py` a `tablaAsta.json`, que carga el importador (#56).
 *
 *   python3 scripts/tabla-asta/extraer.py "~/Downloads/…asta硒鼓适用机型表….xlsx"
 *   pnpm tabla-asta:generar
 *
 * Aquí solo pasa una cosa, y es la que importa: el texto de las máquinas —tal
 * como lo escribe la fábrica, «P1002/1003/1004/1005»— se parte en modelos con
 * `separarModelos`, el mismo que usa la tabla escrita a mano. No se reimplementa
 * nada: esa función ya sabe heredar el prefijo, distinguir el guion de
 * «ML-1916» del que separa, y no inventarse lo que no está.
 *
 * Lo que no pasa el filtro queda contado y a la vista al final, porque una fila
 * perdida en silencio es una impresora que el kiosco no reconocerá y nadie
 * sabrá por qué.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { separadoresABarra } from '../../apps/middleware/src/services/recomendador/extraerImpresoras.js';
import { separarModelos } from '../../apps/middleware/src/services/recomendador/separarModelos.js';

/** Lo que trae el extractor, una fila de la tabla. */
interface FilaCruda {
  marca: string;
  hoja: string;
  fila: number;
  codigos: string[];
  maquinas: string;
}

/** Lo que consume el importador; `ListaFabricante` más de dónde salió. */
interface FilaLista {
  marca: string;
  cartuchos: string[];
  impresoras: string[];
  hoja: string;
  fila: number;
}

const ORIGEN = fileURLToPath(new URL('tabla-asta.json', import.meta.url));
const DESTINO = fileURLToPath(new URL('../../apps/middleware/src/services/recomendador/tablaAsta.json', import.meta.url));

const crudas: FilaCruda[] = JSON.parse(readFileSync(ORIGEN, 'utf8'));
const salida: FilaLista[] = [];
let sinModelos = 0;

for (const f of crudas) {
  // Cada línea de la celda es una familia aparte: «HP LaserJet Pro M404…\nHP
  // LaserJet Enterprise M406…». La coma es el separador que `separarModelos`
  // entiende para eso, y así no se arrastra la familia de una línea a la otra.
  // Y los que la fábrica separa con un espacio —«2168 SCX-3400», «SCX-3406
  // SF-760P»— los pasa a barras `separadoresABarra`, el mismo arreglo que ya
  // hizo falta al leer los nombres de producto (#129). Sin él salen pegados y
  // el kiosco no reconoce ninguno de los dos.
  const texto = separadoresABarra(f.maquinas.replace(/\s*\n+\s*/g, ', '));
  const { modelos } = separarModelos(texto, f.marca);
  if (modelos.length === 0) {
    sinModelos++;
    continue;
  }
  salida.push({ marca: f.marca, cartuchos: f.codigos, impresoras: modelos, hoja: f.hoja, fila: f.fila });
}

writeFileSync(DESTINO, `${JSON.stringify(salida, null, 1)}\n`, 'utf8');

const porMarca = new Map<string, number>();
const impresoras = new Set<string>();
for (const f of salida) {
  porMarca.set(f.marca, (porMarca.get(f.marca) ?? 0) + 1);
  for (const i of f.impresoras) impresoras.add(`${f.marca} ${i.toLowerCase()}`);
}
console.log(`${salida.length} filas → tablaAsta.json  (${impresoras.size} impresoras distintas)`);
for (const [marca, n] of [...porMarca].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${marca}`);
console.log(`   ${String(sinModelos).padStart(4)}  descartadas: de su texto no sale ningún modelo`);
