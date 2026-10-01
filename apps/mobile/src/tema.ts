import type { EstadoStock } from './api.js';

/**
 * Identidad visual del kiosco (#40).
 *
 * ── De dónde sale ────────────────────────────────────────────────────────────
 *
 * Del logo de Asta: el azul (#0E8FDA) y sus letras de trazo grueso, cortes
 * rectos y esquinas apenas redondeadas. Por eso Archivo en los títulos —una
 * grotesca de la misma familia de formas— y radios pequeños en vez de las
 * píldoras blandas de una plantilla. Los modelos y los códigos de cartucho van
 * en monoespaciada (JetBrains Mono), como vienen impresos en la etiqueta de la
 * impresora y en la caja del tóner: es lo que el cliente compara letra a letra.
 *
 * Fondo claro: la tablet está en una tienda iluminada, y ahí un fondo oscuro
 * refleja y se lee peor. El azul de marca llena la pantalla de atracción, que
 * es la que tiene que verse desde el pasillo.
 *
 * ── Tamaños ──────────────────────────────────────────────────────────────────
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
    azul: '#0E8FDA',
    azulHondo: '#0A6FAD',
    azulSuave: '#E3F2FC',
    /** Texto secundario sobre el azul de marca. */
    sobreAzul: '#CFEAFB',

    papel: '#F2F5F8',
    superficie: '#FFFFFF',
    linea: '#D8E0E8',
    tecla: '#E6ECF2',

    tinta: '#0B1F33',
    tintaSuave: '#46596B',
    tintaTenue: '#7E8E9E',

    disponible: '#12805C',
    disponibleSuave: '#E2F4EC',
    bajo: '#9A5800',
    bajoSuave: '#FDF0D9',
    agotado: '#B42318',
    agotadoSuave: '#FCE9E7',
  },
  /** Los nombres son los de `useFonts` en `App.tsx`. */
  fuente: {
    titulo: 'Archivo_800ExtraBold',
    fuerte: 'Archivo_700Bold',
    medio: 'Archivo_600SemiBold',
    cuerpo: 'Archivo_500Medium',
    codigo: 'JetBrainsMono_800ExtraBold',
    codigoFuerte: 'JetBrainsMono_700Bold',
    codigoCuerpo: 'JetBrainsMono_500Medium',
  },
  texto: {
    gigante: 72,
    titulo: 40,
    subtitulo: 28,
    cuerpo: 24,
    etiqueta: 20,
  },
  espacio: { xs: 8, s: 16, m: 24, l: 40, xl: 64 },
  alturaBoton: 72,
  /** Esquinas cortas, como las del logo. */
  radio: 6,
} as const;

/** El color del estado de existencia. Mismo criterio en toda la app. */
export function colorDeStock(stock: EstadoStock): { texto: string; fondo: string } {
  const c = TEMA.color;
  return {
    disponible: { texto: c.disponible, fondo: c.disponibleSuave },
    bajo: { texto: c.bajo, fondo: c.bajoSuave },
    agotado: { texto: c.agotado, fondo: c.agotadoSuave },
  }[stock];
}

/** Lo que se le dice al cliente de cada estado. "bajo" no se dice: apremia sin informar. */
export function textoDeStock(stock: EstadoStock): string {
  return { disponible: 'Hay en tienda', bajo: 'Últimas unidades', agotado: 'Sin existencia' }[stock];
}
