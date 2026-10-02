/**
 * El WhatsApp de soporte, para quien no consigue entrar.
 *
 * El número va en `SOPORTE_WHATSAPP` (variables de `asta-web` en EasyPanel), no
 * en el código: si cambia, se cambia allí sin desplegar. Se acepta escrito como
 * se quiera —«+58 412-123 4567»— y se queda con las cifras, que es lo que pide
 * wa.me: código de país y número, sin «+» ni ceros delante.
 *
 * Sin número configurado devuelve null, y el login enseña la ayuda de siempre en
 * vez de un enlace que no lleva a nadie.
 */
export function enlaceWhatsappSoporte(mensaje: string): string | null {
  const numero = (process.env.SOPORTE_WHATSAPP ?? '').replace(/\D/g, '');
  // Menos de 8 cifras no es un número con su código de país: mejor nada que un enlace roto.
  if (numero.length < 8) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}
