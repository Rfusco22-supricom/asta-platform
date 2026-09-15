/**
 * Normalización de modelos de impresora y códigos de cartucho (#38, #56).
 *
 * La gente escribe "hl2350", no "HL-L2350DW". Lo que se compara no es lo que se
 * escribió sino su forma normalizada, y esa forma es también la que se guarda en
 * `printer_models.name_normalized`, `printer_model_aliases.alias_normalized` y
 * `cartridges.code_normalized` (#101). Por eso vive en un solo sitio: si la
 * búsqueda y la carga normalizaran distinto, un alias bien cargado no se
 * encontraría nunca.
 *
 * La regla, la que pide #38: minúsculas, sin espacios, sin guiones, sin acentos.
 * Y además sin el resto de la puntuación que aparece en los nombres reales de
 * Odoo: puntos (`CRG.057H`), barras (`CB435A/CB436A`), guiones bajos.
 */

export function normalizarModelo(texto: string): string {
  // NFD separa "é" en "e" + tilde combinada; el filtro de después quita la
  // tilde con el resto de lo que no es letra o cifra. Sin NFD, "é" desaparecería
  // entera y "Épson" quedaría en "pson".
  return texto
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Hoy la misma regla. Existe aparte para que un cambio en una no arrastre a la otra sin querer. */
export function normalizarCodigoCartucho(texto: string): string {
  return normalizarModelo(texto);
}
