/**
 * Las reglas de la aplicación ASTA en su versión web (PWA). Son las MISMAS que
 * las de las apps nativas, con los mismos nombres:
 *
 *   · `apps/android/.../dominio/Producto.kt`, `Activacion.kt`, `Cache.kt`, `Datos.kt`;
 *   · `apps/ios/AstaKiosco/Dominio/*.swift`.
 *
 * Un cambio de regla va en las tres. Aquí solo hay lógica pura, sin React ni
 * red, para poder probarla (`scripts/aplicacionWeb.test.ts`).
 *
 * La versión web existe mientras no estén las cuentas de App Store y Google
 * Play: se abre en el navegador de la tablet y se instala en la pantalla de
 * inicio.
 */

export interface Impresora {
  id: number;
  marca: string;
  nombre: string;
}

export type EstadoStock = 'disponible' | 'bajo' | 'agotado';

export interface Cartucho {
  marca: string;
  codigo: string;
  tipo: string;
  color?: string | null;
  rendimientoPaginas?: number | null;
  /** Botella de tinta (EcoTank, Smart Tank…) y no cartucho. */
  botella?: boolean;
}

export interface ProductoCompatible {
  id: number;
  templateId: number;
  sku?: string | null;
  nombre: string;
  /** `null` en las tablets sin almacén (las de clientes): solo compatibilidades. */
  stock?: EstadoStock | null;
  tipo: 'original' | 'compatible';
  cartuchos: Cartucho[];
}

export interface Busqueda {
  impresoras: Impresora[];
  sugerencias: Impresora[];
  /** Para enlazar búsqueda, impresora y producto en la telemetría. */
  busquedaId: string | null;
}

// ── Activación ───────────────────────────────────────────────────────────────

/**
 * Lo que se escribió, o lo que trae el QR del panel (`asta-tablet:482913`), solo
 * con los dígitos. `null` si no es un código: 6 dígitos, o 12 el de los
 * revisores.
 */
export function normalizarCodigo(texto: string): string | null {
  let t = texto.trim();
  if (t.toLowerCase().startsWith('asta-tablet:')) t = t.slice('asta-tablet:'.length);
  else if (t.includes(':')) return null;
  const digitos = t.replace(/[\s-]/g, '');
  if (digitos.length !== 6 && digitos.length !== 12) return null;
  if (!/^\d+$/.test(digitos)) return null;
  return digitos;
}

/** Un token de tablet: lo que devuelve `POST /kiosk/vincular`. */
export const esTokenDeTablet = (t: string | null | undefined): t is string => !!t && t.startsWith('asta_kio_');

// ── Producto ─────────────────────────────────────────────────────────────────

const ASTA = /^ASTA\b/i;
const POLVO = /\b(POLVO|POWDER)\b/i;

/** Asta es la marca propia: los compatibles que vende la tienda se llaman así en el ERP. */
export const esAsta = (p: ProductoCompatible) => ASTA.test(p.nombre.trim());

/** Tóner listo para poner, o polvo para rellenar un cartucho. */
export const esPolvo = (p: ProductoCompatible) => POLVO.test(p.nombre);

export type Clase = 'TONER' | 'POLVO' | 'TINTA' | 'CARTUCHO_DE_TINTA' | 'TAMBOR' | 'OTRO';

/** Qué es: tóner, polvo, tinta en botella, cartucho de tinta, tambor u otra cosa. */
export function clase(p: ProductoCompatible): Clase {
  if (esPolvo(p)) return 'POLVO';
  if (p.cartuchos.length > 0 && p.cartuchos.every((c) => c.botella)) return 'TINTA';
  const tipos = new Set(p.cartuchos.map((c) => c.tipo));
  if (tipos.size !== 1) return 'OTRO';
  switch ([...tipos][0]) {
    case 'toner':
      return 'TONER';
    case 'tinta':
      return 'CARTUCHO_DE_TINTA';
    case 'tambor':
      return 'TAMBOR';
    default:
      return 'OTRO';
  }
}

/** «Tóner compatible Asta», «Tambor original Brother», «Polvo de recarga Asta». */
export function titulo(p: ProductoCompatible, impresora: Impresora): string {
  const marca = esAsta(p) ? 'Asta' : (p.cartuchos[0]?.marca ?? impresora.marca);
  const origen = p.tipo === 'original' ? 'original' : 'compatible';
  switch (clase(p)) {
    case 'POLVO':
      return `Polvo de recarga ${marca}`;
    case 'TONER':
      return `Tóner ${origen} ${marca}`;
    case 'TINTA':
      return `Tinta ${origen} ${marca}`;
    case 'CARTUCHO_DE_TINTA':
      return `Cartucho de tinta ${origen} ${marca}`;
    case 'TAMBOR':
      return `Tambor ${origen} ${marca}`;
    default:
      return `Consumible ${origen} ${marca}`;
  }
}

/** Lo que se le dice al cliente de cada estado. */
export const TEXTO_STOCK: Record<EstadoStock, string> = {
  disponible: 'Hay en tienda',
  bajo: 'Últimas unidades',
  agotado: 'Sin existencia',
};

/** Los códigos de cartucho distintos, en el orden en que aparecen. */
export const codigosDeCartucho = (productos: ProductoCompatible[]) => [...new Set(productos.flatMap((p) => p.cartuchos.map((c) => c.codigo)))];

/** «USA EL CARTUCHO» o «USA LA TINTA» (solo si todo son botellas). */
export function encabezadoDeCodigos(productos: ProductoCompatible[]): string {
  const varios = codigosDeCartucho(productos).length > 1;
  const cartuchos = productos.flatMap((p) => p.cartuchos);
  if (cartuchos.length > 0 && cartuchos.every((c) => c.botella)) return varios ? 'USA LAS TINTAS' : 'USA LA TINTA';
  return varios ? 'USA LOS CARTUCHOS' : 'USA EL CARTUCHO';
}

const ORDEN_STOCK: Record<EstadoStock, number> = { disponible: 0, bajo: 1, agotado: 2 };

/**
 * En qué orden se ofrece: lo que hay en tienda antes que lo agotado, cartuchos
 * antes que polvo, Asta antes que las demás marcas y disponible antes que
 * «últimas unidades». `sort` es estable: si todo empata, manda el servidor.
 */
export function ordenarParaRecomendar(productos: ProductoCompatible[]): ProductoCompatible[] {
  const clave = (p: ProductoCompatible) => [p.stock === 'agotado' ? 1 : 0, esPolvo(p) ? 1 : 0, esAsta(p) ? 0 : 1, p.stock ? ORDEN_STOCK[p.stock] : 0];
  return [...productos].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  });
}

/** El sello «Recomendado»: el primero si es un cartucho Asta que hay en tienda. */
export function recomendado(ordenados: ProductoCompatible[]): ProductoCompatible | null {
  const p = ordenados[0];
  return p && esAsta(p) && !esPolvo(p) && p.stock !== 'agotado' ? p : null;
}

/**
 * Qué se le pone delante al cliente. La aplicación solo ofrece Asta: si la
 * impresora tiene consumibles verificados pero ninguno es Asta, se manda al
 * mostrador (`sinAsta`); si no tiene ninguno verificado, es un paso que falta
 * (`sinNada`).
 */
export type ParaEnsenar = { tipo: 'asta'; productos: ProductoCompatible[] } | { tipo: 'sinAsta' } | { tipo: 'sinNada' };

export function queEnsenar(productos: ProductoCompatible[]): ParaEnsenar {
  const asta = productos.filter(esAsta);
  if (asta.length > 0) return { tipo: 'asta', productos: ordenarParaRecomendar(asta) };
  return productos.length === 0 ? { tipo: 'sinNada' } : { tipo: 'sinAsta' };
}

// ── Caché ────────────────────────────────────────────────────────────────────

/**
 * Sin red, la tablet enseña lo último que supo, con la fecha delante. Lo vivo
 * manda; lo guardado rescata solo si no hay red o el ERP no responde.
 */
export const CACHE_PREFIJO = 'asta.cache.';
/** Doce horas: cubre una jornada. */
export const CACHE_VIGENCIA_MS = 12 * 3600_000;
export const CACHE_MAX_ENTRADAS = 200;

export const claveBusqueda = (q: string) => 'busqueda.' + q.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
export const claveCompatibles = (impresoraId: number) => `compatibles.${impresoraId}`;

/** Lo mínimo de un almacén clave → texto: `localStorage` en la tablet, un mapa en los tests. */
export interface Almacen {
  leer(clave: string): string | null;
  guardar(clave: string, valor: string): void;
  borrar(clave: string): void;
  claves(): string[];
}

export interface Guardado<T> {
  datos: T;
  guardadoEn: number;
}

export class CacheLocal {
  constructor(
    private readonly almacen: Almacen,
    private readonly ahora: () => number = Date.now,
  ) {}

  leer<T>(nombre: string): Guardado<T> | null {
    try {
      const crudo = this.almacen.leer(CACHE_PREFIJO + nombre);
      if (!crudo) return null;
      const o = JSON.parse(crudo) as Guardado<T>;
      if (typeof o.guardadoEn !== 'number' || this.ahora() - o.guardadoEn > CACHE_VIGENCIA_MS) return null;
      return o;
    } catch {
      return null;
    }
  }

  guardar<T>(nombre: string, datos: T): void {
    // Sin espacio o ilegible: se pierde la caché, no la consulta.
    try {
      this.almacen.guardar(CACHE_PREFIJO + nombre, JSON.stringify({ datos, guardadoEn: this.ahora() }));
      this.podar();
    } catch {
      /* nada */
    }
  }

  podar(): void {
    const claves = this.almacen.claves().filter((k) => k.startsWith(CACHE_PREFIJO));
    if (claves.length <= CACHE_MAX_ENTRADAS) return;
    const cuando = (k: string) => {
      try {
        return (JSON.parse(this.almacen.leer(k) ?? '') as Guardado<unknown>).guardadoEn ?? 0;
      } catch {
        return 0;
      }
    };
    claves
      .map((k) => [k, cuando(k)] as const)
      .sort((a, b) => a[1] - b[1])
      .slice(0, claves.length - CACHE_MAX_ENTRADAS)
      .forEach(([k]) => this.almacen.borrar(k));
  }
}

/** «hace 3 min», «hace 2 horas». */
export function haceCuanto(guardadoEn: number, ahora = Date.now()): string {
  const minutos = Math.max(0, Math.round((ahora - guardadoEn) / 60_000));
  if (minutos < 1) return 'hace menos de un minuto';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`;
}

// ── Sesión ───────────────────────────────────────────────────────────────────

/**
 * La tablet es compartida: la sesión se cierra sola a los 4 minutos sin tocar,
 * con aviso 30 s antes, y al cerrarse no queda nada del cliente en pantalla.
 */
export const SESION_MS = 4 * 60_000;
export const AVISO_ANTES_MS = 30_000;
/** Señal de vida para el panel: menos que el umbral de la alerta de tablet caída (30 min). */
export const LATIDO_MS = 10 * 60_000;
/** Mientras algo está caído, se comprueba cada 15 s. */
export const REINTENTO_MS = 15_000;
/** Ningún modelo se acerca a esto; más es alguien apoyado en el teclado. */
export const MAX_LARGO = 24;
