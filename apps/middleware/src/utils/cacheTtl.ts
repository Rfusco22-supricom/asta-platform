/**
 * Cache en memoria con caducidad y tamaño acotado.
 *
 * En memoria del proceso, como los limitadores de #29: con una instancia basta,
 * y moverla a Redis o MySQL es la decisión de #14. Lo que NO puede ser es un
 * `Map` sin límite: la clave incluye lo que manda el cliente (`q`, `sku`), así
 * que cualquiera podría llenarla de búsquedas distintas.
 *
 * Al llenarse se descarta la entrada más antigua: un `Map` recorre sus claves en
 * orden de inserción.
 */
export class CacheTtl<V> {
  private readonly entradas = new Map<string, { valor: V; caduca: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntradas: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  get(clave: string): V | undefined {
    const e = this.entradas.get(clave);
    if (!e) return undefined;
    if (e.caduca <= this.ahora()) {
      this.entradas.delete(clave);
      return undefined;
    }
    return e.valor;
  }

  set(clave: string, valor: V): void {
    this.entradas.delete(clave);
    if (this.entradas.size >= this.maxEntradas) {
      const masAntigua = this.entradas.keys().next().value;
      if (masAntigua !== undefined) this.entradas.delete(masAntigua);
    }
    this.entradas.set(clave, { valor, caduca: this.ahora() + this.ttlMs });
  }

  vaciar(): void {
    this.entradas.clear();
  }

  /**
   * Borra las entradas que cumplan `pred`. Devuelve cuántas.
   *
   * Para invalidar por lo que cambió en Odoo (#34) sin vaciar lo demás: si
   * cambia una regla de la tarifa 15836, los precios de la 15863 siguen valiendo.
   */
  borrarSi(pred: (clave: string, valor: V) => boolean): number {
    let borradas = 0;
    for (const [clave, e] of this.entradas) {
      if (pred(clave, e.valor)) {
        this.entradas.delete(clave);
        borradas++;
      }
    }
    return borradas;
  }

  get tamanio(): number {
    return this.entradas.size;
  }
}
