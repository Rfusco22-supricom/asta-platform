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
 * ── Mantenerlas calientes ────────────────────────────────────────────────────
 *
 * Con solo lo de arriba, quien vuelve a una pantalla pasados `maximoMs` espera
 * a Odoo entera (medido el 25-nov-2026: el Inicio del administrador, 20 s en
 * frío y 0,6 s en caliente). `renovarUsadas` vuelve a leer por detrás las
 * claves que alguien pidió hace poco antes de que caduquen, con el mismo
 * `cargar` de su última petición: lo programa el servidor (`pantallas.ts`).
 *
 * En memoria del proceso y con tamaño acotado, como `CacheTtl` (#14). La clave
 * la decide quien llama, y tiene que llevar todo lo que cambia la respuesta: el
 * vendedor, el periodo… Nunca debe poder pedirse la de otro.
 */
export class CacheConRefresco<V> {
  private readonly entradas = new Map<string, { valor: V; guardado: number }>();
  /** Cuándo se pidió cada clave por última vez, y con qué lectura: lo que usa `renovarUsadas`. */
  private readonly usadas = new Map<string, { usado: number; cargar: () => Promise<V> }>();
  private readonly enCurso = new Map<string, Promise<V>>();
  /**
   * Cuántas veces se olvidó cada clave. Una lectura recuerda la versión con la
   * que empezó: si al terminar ya es otra, alguien olvidó la clave mientras
   * tanto y lo leído puede ser de antes del cambio, así que no se guarda.
   */
  private readonly version = new Map<string, number>();

  constructor(
    private readonly frescoMs: number,
    private readonly maximoMs: number,
    private readonly maxEntradas: number,
    private readonly ahora: () => number = Date.now,
  ) {}

  async obtener(clave: string, cargar: () => Promise<V>): Promise<V> {
    this.usadas.delete(clave);
    this.usadas.set(clave, { usado: this.ahora(), cargar });
    if (this.usadas.size > this.maxEntradas) {
      const masAntigua = this.usadas.keys().next().value;
      if (masAntigua !== undefined) this.usadas.delete(masAntigua);
    }
    const e = this.entradas.get(clave);
    const edad = e ? this.ahora() - e.guardado : Infinity;
    if (e && edad < this.frescoMs) return e.valor;
    if (e && edad < this.maximoMs) {
      this.leer(clave, cargar).catch(() => undefined);
      return e.valor;
    }
    return this.leer(clave, cargar);
  }

  /**
   * Vuelve a leer, por detrás, lo que alguien pidió hace menos de `usadasEnMs`
   * y se guardó hace más de `masViejasDeMs`: así sigue caliente cuando vuelva.
   * Las más recientes primero, como mucho `maximo`, y `enParalelo` a la vez
   * para no cargar a Odoo. Un fallo deja lo que había, como al renovar por
   * detrás en `obtener`.
   */
  async renovarUsadas(opciones: {
    usadasEnMs: number;
    masViejasDeMs: number;
    maximo: number;
    enParalelo: number;
    /**
     * Si todavía vale renovar lo pedido en `usado`. La lectura que se repite es
     * la de esa petición, con lo que ella sabía (la fecha de hoy, por ejemplo):
     * pasado un cambio de día ya no se debe repetir.
     */
    vigente?: (usado: number, ahora: number) => boolean;
  }): Promise<{ renovadas: number; fallidas: number }> {
    const ahora = this.ahora();
    const pendientes = [...this.usadas.entries()]
      .filter(([clave, u]) => {
        if (ahora - u.usado >= opciones.usadasEnMs) return false;
        if (opciones.vigente && !opciones.vigente(u.usado, ahora)) return false;
        const e = this.entradas.get(clave);
        return !e || ahora - e.guardado > opciones.masViejasDeMs;
      })
      .sort((a, b) => b[1].usado - a[1].usado)
      .slice(0, opciones.maximo);
    let renovadas = 0;
    let fallidas = 0;
    const cola = [...pendientes];
    const trabajar = async () => {
      for (let siguiente = cola.shift(); siguiente; siguiente = cola.shift()) {
        const [clave, u] = siguiente;
        try {
          await this.leer(clave, u.cargar);
          renovadas++;
        } catch {
          fallidas++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opciones.enParalelo) }, trabajar));
    return { renovadas, fallidas };
  }

  vaciar(): void {
    this.usadas.clear();
    this.entradas.clear();
    this.enCurso.clear();
    this.version.clear();
  }

  /**
   * Olvida una clave: la próxima petición espera a la fuente. Para cuando quien
   * llama acaba de cambiar justo lo que esa clave guarda. Una lectura que ya
   * estuviera en curso no se cancela, pero su resultado tampoco se guarda.
   */
  olvidar(clave: string): void {
    this.entradas.delete(clave);
    this.enCurso.delete(clave);
    this.version.set(clave, (this.version.get(clave) ?? 0) + 1);
  }

  private leer(clave: string, cargar: () => Promise<V>): Promise<V> {
    const pendiente = this.enCurso.get(clave);
    if (pendiente) return pendiente;
    const version = this.version.get(clave) ?? 0;
    const p = cargar()
      .then((valor) => {
        // Olvidada mientras se leía: lo leído puede ser de antes del cambio.
        if ((this.version.get(clave) ?? 0) !== version) return valor;
        this.entradas.delete(clave);
        if (this.entradas.size >= this.maxEntradas) {
          const masAntigua = this.entradas.keys().next().value;
          if (masAntigua !== undefined) this.entradas.delete(masAntigua);
        }
        this.entradas.set(clave, { valor, guardado: this.ahora() });
        return valor;
      })
      .finally(() => {
        if (this.enCurso.get(clave) === p) this.enCurso.delete(clave);
      });
    this.enCurso.set(clave, p);
    return p;
  }
}
