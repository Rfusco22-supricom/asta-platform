/**
 * El tema del panel: claro, oscuro o el del sistema.
 *
 * Vive en una cookie y no en `localStorage` porque lo lee el SERVIDOR al pintar
 * (`app/layout.tsx`): así la página llega con el tema correcto y no parpadea.
 * No es un dato de sesión ni sensible, y por eso no es httpOnly: el menú lo
 * cambia desde el navegador sin pasar por el servidor.
 */

export const COOKIE_TEMA = 'asta_tema';

export type Tema = 'claro' | 'oscuro' | 'sistema';

/** Lo que va en `data-theme`: el CSS habla en inglés, como la convención. */
export const ATRIBUTO_TEMA: Record<Exclude<Tema, 'sistema'>, 'light' | 'dark'> = { claro: 'light', oscuro: 'dark' };

export function temaValido(valor: string | undefined): 'light' | 'dark' | 'sistema' {
  if (valor === 'claro') return 'light';
  if (valor === 'oscuro') return 'dark';
  return 'sistema';
}

/** Aplica el tema en la página abierta y lo recuerda un año. Solo en el navegador. */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === 'sistema') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', ATRIBUTO_TEMA[tema]);
  document.cookie = `${COOKIE_TEMA}=${tema}; path=/; max-age=31536000; samesite=lax`;
}

/** El tema guardado, leído en el navegador. */
export function temaActual(): Tema {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_TEMA}=([^;]*)`));
  return m?.[1] === 'claro' || m?.[1] === 'oscuro' ? m[1] : 'sistema';
}
