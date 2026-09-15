/**
 * A dónde pertenece cada rol.
 *
 * ── Por qué es una función y no un `?:` repetido ─────────────────────────────
 *
 * Estaba escrito dos veces —en la raíz y al terminar el login— con el comentario
 * «mismo criterio que la raíz» al lado de la copia. No era el mismo criterio:
 * era una copia, y en cuanto #28 añadió a los CLIENTES se arregló una y la otra
 * se quedó igual.
 *
 * El síntoma fue justo el que el texto de la raíz decía evitar: un cliente
 * entraba con su contraseña, aterrizaba en `/cartera` y leía «Tu rol no tiene
 * permiso para esta operación» en su primera pantalla del producto.
 *
 * Cualquier sitio nuevo que decida a dónde mandar a alguien entra aquí. Si un
 * rol pierde su destino, se ve en un fichero de veinte líneas y no repartido por
 * la aplicación.
 */

const CLIENTES = ['BRONCE', 'PLATA', 'GOLD'];

export function destinoPara(role: string): string {
  // Un SUPERADMIN no tiene cartera: la matriz de permisos se la niega a
  // propósito, así que mandarle a /cartera sería un 403 nada más entrar.
  if (role === 'SUPERADMIN') return '/admin';

  /*
   * Los clientes van a sus API keys (#28).
   *
   * No porque sea lo más importante para ellos, sino porque es lo único suyo
   * que existe hoy. Cuando haya más pantallas de cliente, esto apuntará a su
   * índice y dejará de ser un destino final.
   */
  if (CLIENTES.includes(role)) return '/cuenta/api-keys';

  return '/cartera';
}
