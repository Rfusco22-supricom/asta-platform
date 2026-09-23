/**
 * Caché local del kiosco (#42).
 *
 * «Una tablet en blanco en piso de venta es peor que una con datos de hace diez
 * minutos», dice el issue. Sin red, la tablet enseña lo último que supo, con la
 * fecha delante, en vez de una pantalla de error.
 *
 * ── Qué se guarda ────────────────────────────────────────────────────────────
 *
 * Lo que el cliente ha consultado: las búsquedas de impresora y los productos
 * compatibles de cada una. No se precarga el catálogo entero —son miles de
 * productos y cada tienda usa un puñado—: se guarda lo que de verdad se pregunta,
 * que además es lo que más se repite.
 *
 * ── Qué NO se guarda ─────────────────────────────────────────────────────────
 *
 * Nada de un cliente: hoy se consulta como visitante y no hay precios (#31).
 * Cuando los haya, esto **no** los puede guardar sin más: son de la sesión, y la
 * sesión se borra al cerrarse (#41). Está escrito aquí para que no se olvide.
 *
 * ── El almacén se inyecta ────────────────────────────────────────────────────
 *
 * `Almacen` es la interfaz mínima de AsyncStorage. Así los tests usan uno en
 * memoria y prueban de verdad el vencimiento y el tope, sin React Native.
 */

export interface Almacen {
  getItem: (clave: string) => Promise<string | null>;
  setItem: (clave: string, valor: string) => Promise<void>;
  removeItem: (clave: string) => Promise<void>;
  getAllKeys: () => Promise<readonly string[]>;
}

export interface Guardado<T> {
  datos: T;
  /** Cuándo se guardó, en epoch ms. Es lo que se le enseña al cliente. */
  guardadoEn: number;
}

const PREFIJO = 'asta.cache.';

/**
 * Cuánto se sigue enseñando algo guardado cuando no hay red.
 *
 * Doce horas: cubre una jornada, que es el caso real —la tienda se queda sin
 * internet media mañana—. Más allá, la existencia de ayer ya no dice nada útil y
 * es mejor admitir que no se sabe.
 */
export const MS_VIGENCIA = 12 * 3600_000;

/** Tope de entradas. Una tablet no tiene por qué acumular meses de consultas. */
export const MAX_ENTRADAS = 200;

export class CacheLocal {
  constructor(
    private readonly almacen: Almacen,
    private readonly ahora: () => number = Date.now,
  ) {}

  private clave(nombre: string): string {
    return `${PREFIJO}${nombre}`;
  }

  /** Lo guardado, si no ha caducado. `null` si no hay nada o ya no vale. */
  async leer<T>(nombre: string): Promise<Guardado<T> | null> {
    let crudo: string | null;
    try {
      crudo = await this.almacen.getItem(this.clave(nombre));
    } catch {
      // Un almacén que falla no puede tumbar la consulta: se sigue sin caché.
      return null;
    }
    if (!crudo) return null;

    let guardado: Guardado<T>;
    try {
      guardado = JSON.parse(crudo) as Guardado<T>;
    } catch {
      return null;
    }
    if (typeof guardado?.guardadoEn !== 'number' || guardado.datos === undefined) return null;
    if (this.ahora() - guardado.guardadoEn > MS_VIGENCIA) return null;
    return guardado;
  }

  async guardar<T>(nombre: string, datos: T): Promise<void> {
    try {
      await this.almacen.setItem(this.clave(nombre), JSON.stringify({ datos, guardadoEn: this.ahora() } satisfies Guardado<T>));
      await this.podar();
    } catch {
      // Sin espacio o sin permisos: se pierde la caché, no la consulta.
    }
  }

  /** Al cerrar la sesión no se borra: lo guardado no es de nadie (ver arriba). */
  async podar(): Promise<void> {
    const claves = (await this.almacen.getAllKeys()).filter((k) => k.startsWith(PREFIJO));
    if (claves.length <= MAX_ENTRADAS) return;

    const conFecha = await Promise.all(
      claves.map(async (k) => {
        const crudo = await this.almacen.getItem(k);
        let en = 0;
        try {
          en = (JSON.parse(crudo ?? '{}') as Guardado<unknown>).guardadoEn ?? 0;
        } catch {
          en = 0; // ilegible: que se vaya el primero
        }
        return { k, en };
      }),
    );
    const sobran = conFecha.sort((a, b) => a.en - b.en).slice(0, claves.length - MAX_ENTRADAS);
    for (const { k } of sobran) await this.almacen.removeItem(k);
  }
}

/** Nombres de caché. En un sitio para que leer y guardar no se desincronicen. */
export const CLAVES = {
  busqueda: (q: string) => `busqueda.${q.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  compatibles: (printerId: number) => `compatibles.${printerId}`,
};
