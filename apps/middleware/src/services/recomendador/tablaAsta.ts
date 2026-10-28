import type { ListaFabricante } from './importarListasFabricante.js';
import filas from './tablaAsta.json';

/**
 * La tabla de compatibilidades de la FÁBRICA de ASTA (#56).
 *
 * «asta硒鼓适用机型表» —tabla de modelos compatibles de los tóners ASTA—, el
 * libro de Excel que mandó el dueño de la marca. Una hoja por marca de
 * impresora y, en cada fila, un tóner con las máquinas en las que sirve.
 *
 * Es otra cosa que `LISTA_ASTA` (#251), que son 57 filas de un PDF del
 * distribuidor para Venezuela: esto es el catálogo entero de la fábrica. Y es
 * otra cosa que `LISTAS_FABRICANTE`, que sale de la web de HP, Canon o Epson.
 * Las tres entran por el mismo importador y todas como PROPUESTA.
 *
 * ── Por qué esta fuente vale ─────────────────────────────────────────────────
 *
 * Porque es quien fabrica lo que vendemos, y porque se puede contrastar: donde
 * hay las dos, coincide con la web del fabricante —el CRG-125 da las mismas
 * tres imageCLASS que Canon USA—, y donde la web publica rangos, esta da los
 * modelos. Del 150A, HP solo dice «M109-M112»; aquí están la M110we, la M111a,
 * la M111w y las tres MFP M141. Del 414A, la tienda de HP nombra cuatro
 * modelos; la tabla, siete.
 *
 * ── De dónde sale este fichero ───────────────────────────────────────────────
 *
 * `tablaAsta.json` no se escribe a mano: lo generan dos pasos, y los dos están
 * en `scripts/tabla-asta/`:
 *
 *   python3 scripts/tabla-asta/extraer.py "<el .xlsx>"   # hoja y fila incluidas
 *   pnpm tabla-asta:generar                              # parte los modelos
 *
 * Cuando ASTA mande una tabla nueva se vuelven a pasar los dos y se revisa el
 * diff, que es donde se ven los modelos que entran y los que desaparecen.
 *
 * ── Lo que NO trae ───────────────────────────────────────────────────────────
 *
 * Tinta. Es una tabla de 硒鼓, tóner y tambor, así que el GT53, el PG-145 o el
 * 664 no están y siguen dependiendo de otra fuente.
 *
 * Y los tóners UNIVERSALES quedan fuera a propósito: en la tabla, una fila como
 * «CB435A/CE285A/CB436A» lleva la unión de las máquinas de los tres, y
 * repartirla diría que el CE285A sirve en una P1006. Esos van por `LISTA_ASTA`,
 * donde cada original lleva lo suyo.
 */

const FUENTE = 'Tabla de compatibilidades de la fábrica ASTA (asta硒鼓适用机型表), recibida el 2026-08-28';

interface FilaTabla {
  marca: string;
  cartuchos: string[];
  impresoras: string[];
  /** La hoja y la fila del Excel: quien valide puede ir a la celda. */
  hoja: string;
  fila: number;
}

export const TABLA_ASTA: ListaFabricante[] = (filas as FilaTabla[]).map((f) => ({
  marca: f.marca,
  cartuchos: f.cartuchos,
  impresoras: f.impresoras,
  fuentes: [`${FUENTE} · hoja ${f.hoja} · fila ${f.fila}`],
  consultado: '2026-08-28',
}));
