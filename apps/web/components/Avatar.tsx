/**
 * El avatar de un cliente: sus iniciales sobre un degradado.
 *
 * El color sale del nombre, no del azar: el mismo cliente tiene el mismo color
 * en Impulsa, en la cartera y en su ficha, y eso ayuda a reconocerlo de un
 * vistazo al pasar de una pantalla a otra.
 *
 * Las iniciales saltan las palabras que no identifican a nadie («C.A.»,
 * «S.A.», «DE», «LA»…): «DISTRIBUIDORA DE TONER C.A.» es «DT», no «DD».
 */

const RELLENO = new Set(['C.A', 'CA', 'C.A.', 'S.A', 'SA', 'S.A.', 'SRL', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', '&', '-']);

const TONOS = 6;

export function iniciales(nombre: string): string {
  const palabras = nombre
    .toUpperCase()
    .split(/[\s,]+/)
    .filter((p) => p && !RELLENO.has(p) && /[A-ZÁÉÍÓÚÑ0-9]/.test(p[0]!));
  if (palabras.length === 0) return '·';
  return (palabras[0]![0]! + (palabras[1]?.[0] ?? '')).toUpperCase();
}

/** Un número estable entre 0 y TONOS-1 a partir del nombre. */
function tono(nombre: string): number {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % TONOS;
}

export function Avatar({ nombre, tamano = 'm' }: { nombre: string; tamano?: 's' | 'm' | 'l' }) {
  return (
    <span className={`avatar-cliente avatar-${tamano} avatar-tono-${tono(nombre)}`} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  );
}
