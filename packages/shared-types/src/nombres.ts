/**
 * Cómo se enseña un nombre que viene de Odoo.
 *
 * En Odoo cada nombre lo escribió quien creó la ficha, y se nota: conviven
 * «DANIELA  SUAREZ», «Luis Mora (v)» y «CARLA PEÑA.» en la misma tabla. El
 * panel no los corrige en Odoo —eso es la pantalla «Calidad de datos»—, pero
 * tampoco tiene por qué enseñarlos así.
 *
 * Solo presentación: lo guardado y lo que se compara con Odoo sigue siendo el
 * texto original. Aquí no se decide nada con estos nombres.
 */

/** Espacios dobles, del principio y del final: fuera. */
export function limpiarEspacios(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/** Partículas que van en minúscula dentro de un nombre: «María de los Ángeles». */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von']);

/**
 * El nombre de una PERSONA (un vendedor), escrito como un nombre.
 *
 * · Quita el «(v)» que algunos llevan al final, y el punto o la coma sueltos.
 * · Si está todo en mayúsculas, lo pasa a «Nombre Apellido».
 * · Si ya tiene minúsculas, se respeta tal cual: quien lo escribió así sabrá
 *   por qué («McKenzie», «Asistente de Ventas CCS»).
 *
 * No sirve para empresas: «INVERSIONES PULSAR, C.A.» va en mayúsculas a
 * propósito, y pasarlo por aquí lo dejaría en «Inversiones Pulsar, C.a».
 */
export function nombrePersona(crudo: string): string {
  const limpio = limpiarEspacios(crudo)
    .replace(/\s*\(v\)$/i, '')
    .replace(/\s*[.,;]+$/, '')
    .trim();
  if (!limpio) return limpiarEspacios(crudo);

  const letras = limpio.replace(/[^\p{L}]/gu, '');
  if (letras !== letras.toLocaleUpperCase('es')) return limpio;

  return limpio
    .toLocaleLowerCase('es')
    .split(' ')
    .map((palabra, i) =>
      i > 0 && PARTICULAS.has(palabra)
        ? palabra
        : palabra.replace(/(^|[-'’])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toLocaleUpperCase('es')),
    )
    .join(' ');
}
