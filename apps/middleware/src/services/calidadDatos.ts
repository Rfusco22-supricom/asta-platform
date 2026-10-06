/**
 * Las comprobaciones de «Calidad de datos», sin red (ver `calidadDatos.service.ts`).
 *
 * Cada función devuelve QUÉ tiene mal el dato, en una frase para la pantalla, o
 * `null` si está bien. Una frase y no un booleano porque la fila tiene que decir
 * qué corregir: «RIF inválido» obliga a abrir la ficha para averiguarlo.
 */

/** Valor de la letra en el cálculo del dígito verificador del SENIAT. */
const VALOR_LETRA: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5, C: 3 };
const PESOS = [3, 2, 7, 6, 5, 4, 3, 2];

/**
 * El dígito verificador de un RIF: letra + ocho cifras.
 *
 * Módulo 11 con los pesos del SENIAT. Comprobado contra Odoo el 6-oct-2026: de
 * 1.676 RIF jurídicos con forma de RIF, cuadran 1.658. Los 18 que no, son erratas.
 */
export function digitoVerificador(letra: string, cifras: string): number {
  let suma = (VALOR_LETRA[letra] ?? 0) * 4;
  for (let i = 0; i < 8; i++) suma += Number(cifras[i]) * PESOS[i]!;
  const d = 11 - (suma % 11);
  return d >= 10 ? 0 : d;
}

/**
 * ¿Qué tiene mal este RIF venezolano?
 *
 * Solo para clientes de las compañías de Venezuela: en las de Panamá lo que hay
 * es un RUC (`8-887-898`, `155679446-2-2019`), que tiene otra forma.
 *
 * Una V o E con seis a ocho cifras es una cédula sin dígito verificador, y es
 * válida: así se factura a una persona.
 */
export function problemaRif(vat: string | false | null): string | null {
  if (!vat || !String(vat).trim()) return 'Sin RIF';
  const original = String(vat).trim();
  const rif = original.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const m = /^([VEJPGC])(\d+)$/.exec(rif);
  if (!m) return `«${original}» no tiene forma de RIF venezolano`;
  const [, letra, cifras] = m as unknown as [string, string, string];

  if ((letra === 'V' || letra === 'E') && cifras.length >= 6 && cifras.length <= 8) return null;
  if (cifras.length !== 9) return `«${original}» tiene ${cifras.length} cifras; un RIF lleva nueve`;

  const esperado = digitoVerificador(letra, cifras.slice(0, 8));
  if (esperado !== Number(cifras[8])) {
    return `«${original}»: el dígito verificador no cuadra (con estas cifras sería ${esperado})`;
  }
  return null;
}

/** Espacios al principio, al final o dobles. */
export function tieneEspaciosDeMas(nombre: string): boolean {
  return /^\s|\s$|\s{2,}/.test(nombre);
}

/**
 * ¿Qué tiene mal el nombre de un vendedor tal como está en Odoo?
 *
 * Ese nombre sale en el panel, en los reportes y en las facturas impresas. Hoy
 * conviven «DANIEL ESPINOZA», «Jose Lopez», «Aaron Jaramillo (v)» y
 * «EMILI BRICEÑO.»: cada uno lo escribió quien creó el usuario.
 */
export function problemasNombreVendedor(nombre: string): string[] {
  const problemas: string[] = [];
  if (/\(v\)\s*$/i.test(nombre)) problemas.push('lleva «(v)» al final');
  if (/^asistente\b/i.test(nombre.trim())) problemas.push('es un puesto, no una persona');
  if (/[.,;]\s*$/.test(nombre)) problemas.push('termina en un signo de puntuación');
  if (tieneEspaciosDeMas(nombre)) problemas.push('tiene espacios de más');
  const letras = nombre.replace(/\(v\)/gi, '').replace(/[^\p{L}]/gu, '');
  if (letras.length > 3 && letras === letras.toUpperCase()) problemas.push('está todo en mayúsculas');
  return problemas;
}
