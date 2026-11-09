/**
 * El modo presentación: para enseñar el panel a un cliente con la cuenta del
 * personal sin enseñarle lo de la empresa. Tapa importes, cifras, nombres de
 * clientes y vendedores y datos de contacto: las reglas están en
 * `public/tapado.js`.
 *
 * Vive en una cookie, como el tema (`lib/tema.ts`), porque lo lee el SERVIDOR:
 * la página llega con el script que tapa en el <head>, antes de pintar nada.
 * No es un permiso ni un dato de sesión, sino una preferencia de ese navegador:
 * el dato sigue en la página, solo no se ve.
 */

export const COOKIE_PRESENTACION = 'asta_presentacion';

export function presentacionDe(valor: string | undefined): boolean {
  return valor === '1';
}

/**
 * Lo enciende o lo apaga y recarga la página. Recargar no es pereza: el script
 * tiene que estar desde antes del primer pintado, y al apagarlo hay que
 * devolver los textos que se taparon.
 */
export function cambiarPresentacion(activa: boolean): void {
  document.cookie = activa
    ? `${COOKIE_PRESENTACION}=1; path=/; max-age=31536000; samesite=lax`
    : `${COOKIE_PRESENTACION}=; path=/; max-age=0; samesite=lax`;
  location.reload();
}
