/**
 * Cache que contesta con lo guardado y lo renueva por detrás.
 *
 * Las pantallas del panel leen Odoo en cada carga, y cada lectura cuesta de uno
 * a tres segundos (medido el 9-oct-2026). Volver a una sección a los diez
 * segundos repetía la espera entera por los mismos números. Con esto:
 *
 *   · más nuevo que `frescoMs`: se contesta con lo guardado;
 *   · entre `frescoMs` y `maximoMs`: se contesta con lo guardado AL MOMENTO, y
 *     se pide a Odoo por detrás para la próxima vez;
 *   · más viejo que `maximoMs`, o nada guardado: se espera a Odoo.
 *
 * Así lo que se ve nunca tiene más de `maximoMs`, y casi nunca se espera.
 *
 * Dos peticiones a la vez por la misma clave comparten una sola lectura: diez
 * vendedores abriendo el panel a las ocho no son diez consultas iguales.
 *
 * Un fallo al renovar por detrás no se propaga: se queda lo que había y se
 * vuelve a intentar en la siguiente petición. Un fallo sin nada guardado sí,
 * porque no hay qué contestar.
 *
 * En memoria del proceso y con tamaño acotado, como `CacheTtl` (#14). La clave
 * la decide quien llama, y tiene que llevar todo lo que cambia la respuesta: el
 * vendedor, el periodo… Nunca debe poder pedirse la de otro.
 */
export class CacheConRefresco<V> {
  private readonly entradas = new Map<string, { valor: V; guardado: number }>();
  private readonly enCurso = new Map<string, Promise<V>>();

  constructor(
    private readonly frescoMs: number,
    private readonly maximoMs: number,
    private readonly maxEntradas: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  async obtener(clave: string, cargar: () => Promise<V>): Promise<V> {
    const e = this.entradas.get(clave);
    const edad = e ? this.ahora() - e.guardado : Infinity;
    if (e && edad < this.frescoMs) return e.valor;
    if (e && edad < this.maximoMs) {
      this.leer(clave, cargar).catch(() => undefined);
      return e.valor;
    }
    return this.leer(clave, cargar);
  }

  vaciar(): void {
    this.entradas.clear();
    this.enCurso.clear();
  }

  private leer(clave: string, cargar: () => Promise<V>): Promise<V> {
    const pendiente = this.enCurso.get(clave);
    if (pendiente) return pendiente;
    const p = cargar()
      .then((valor) => {
        this.entradas.delete(clave);
        if (this.entradas.size >= this.maxEntradas) {
          const masAntigua = this.entradas.keys().next().value;
          if (masAntigua !== undefined) this.entradas.delete(masAntigua);
        }
        this.entradas.set(clave, { valor, guardado: this.ahora() });
        return valor;
      })
      .finally(() => this.enCurso.delete(clave));
    this.enCurso.set(clave, p);
    return p;
  }
}
