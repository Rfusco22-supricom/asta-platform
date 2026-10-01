/**
 * Tipografía y colores del kiosco (#40).
 *
 * La tablet se usa DE PIE y a distancia de brazo, no en la mano: todo es más
 * grande de lo que parece razonable en un móvil. El cuerpo base son 24 px, el
 * doble de lo habitual, y ningún texto que el cliente tenga que leer baja de 20.
 *
 * Los botones tienen 72 px de alto: en una pantalla que se toca de pie, con
 * prisa y a veces con guantes de almacén, los objetivos pequeños se fallan.
 */
export const TEMA = {
  color: {
    fondo: '#0f172a',
    superficie: '#1e293b',
    texto: '#f8fafc',
    textoTenue: '#94a3b8',
    acento: '#38bdf8',
    disponible: '#4ade80',
    bajo: '#fbbf24',
    agotado: '#f87171',
  },
  texto: {
    gigante: 64,
    titulo: 40,
    subtitulo: 28,
    cuerpo: 24,
    etiqueta: 20,
  },
  espacio: { xs: 8, s: 16, m: 24, l: 40, xl: 64 },
  alturaBoton: 72,
  radio: 16,
} as const;

/** El color del estado de existencia. Mismo criterio en toda la app. */
export function colorDeStock(stock: 'disponible' | 'bajo' | 'agotado'): string {
  return { disponible: TEMA.color.disponible, bajo: TEMA.color.bajo, agotado: TEMA.color.agotado }[stock];
}

/** Lo que se le dice al cliente de cada estado. "bajo" no se dice: apremia sin informar. */
export function textoDeStock(stock: 'disponible' | 'bajo' | 'agotado'): string {
  return { disponible: 'Disponible', bajo: 'Últimas unidades', agotado: 'Sin existencia' }[stock];
}
