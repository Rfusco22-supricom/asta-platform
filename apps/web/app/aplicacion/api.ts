import { CacheLocal, claveBusqueda, claveCompatibles, esTokenDeTablet, normalizarCodigo, type Almacen, type Busqueda, type Impresora, type ProductoCompatible } from './dominio';

/**
 * Cliente de la API de las tablets para la aplicación web. El mismo contrato que
 * `Api.kt` / `Api.swift`, pero por el panel (`/api/aplicacion/…`, ver
 * `app/api/aplicacion/[...ruta]/route.ts`): mismo origen, sin CORS, y el panel
 * reenvía la IP para el límite de códigos equivocados.
 *
 * Nada aquí lanza: cada llamada devuelve un resultado que hay que mirar. Una
 * excepción sin tratar deja la tablet en blanco delante del cliente.
 */

export type MotivoFallo = 'RED' | 'ERP' | 'SERVIDOR' | 'PERMISO';
export type Resultado<T> = { ok: true; datos: T } | { ok: false; motivo: MotivoFallo };

const BASE = '/api/aplicacion';
export const VERSION_WEB = 'web-1.0.0';

/** `localStorage`, que puede no estar (navegación privada) o estar lleno. */
export const almacenNavegador: Almacen = {
  leer: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  guardar: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* lleno o bloqueado */
    }
  },
  borrar: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nada */
    }
  },
  claves: () => {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};

async function enviar(ruta: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(BASE + ruta, { ...init, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
}

async function motivoDe(r: Response): Promise<MotivoFallo> {
  if (r.status === 401 || r.status === 403) return 'PERMISO';
  const cuerpo = (await r.json().catch(() => null)) as { error?: { code?: string } } | null;
  const codigo = cuerpo?.error?.code;
  // El panel no llega al middleware: para la tablet es lo mismo que no tener red.
  if (codigo === 'MIDDLEWARE_UNREACHABLE') return 'RED';
  // El middleware contestó y dijo que Odoo no responde: aquí la caché sí rescata.
  if (r.status === 503 && codigo === 'ODOO_UNAVAILABLE') return 'ERP';
  return 'SERVIDOR';
}

export class ClienteApi {
  constructor(private readonly token: string) {}

  private async pedir<T>(ruta: string, metodo: 'GET' | 'POST' = 'GET', cuerpo?: unknown): Promise<Resultado<T>> {
    const r = await enviar(ruta, {
      method: metodo,
      headers: { 'X-API-Key': this.token, 'X-App-Version': VERSION_WEB, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    if (!r) return { ok: false, motivo: 'RED' };
    if (!r.ok) return { ok: false, motivo: await motivoDe(r) };
    try {
      return { ok: true, datos: (await r.json()) as T };
    } catch {
      return { ok: false, motivo: 'SERVIDOR' };
    }
  }

  /** El latido, diciendo si el servidor aún acepta el token. */
  async comprobar(): Promise<'VALIDO' | 'RECHAZADO' | 'SIN_RESPUESTA'> {
    const r = await this.pedir('/latido');
    if (r.ok) return 'VALIDO';
    return r.motivo === 'PERMISO' ? 'RECHAZADO' : 'SIN_RESPUESTA';
  }

  async buscarImpresoras(q: string): Promise<Resultado<Busqueda>> {
    const r = await this.pedir<{ data: Impresora[]; sugerencias: Impresora[]; meta?: { busquedaId?: string | null } }>(`/recommender/printers?q=${encodeURIComponent(q)}&limit=12`);
    if (!r.ok) return r;
    return { ok: true, datos: { impresoras: r.datos.data, sugerencias: r.datos.sugerencias ?? [], busquedaId: r.datos.meta?.busquedaId ?? null } };
  }

  async compatiblesDe(impresoraId: number, busquedaId: string | null): Promise<Resultado<ProductoCompatible[]>> {
    const q = busquedaId ? `?busquedaId=${encodeURIComponent(busquedaId)}` : '';
    const r = await this.pedir<{ data: ProductoCompatible[] }>(`/recommender/printers/${impresoraId}/compatible${q}`);
    return r.ok ? { ok: true, datos: r.datos.data } : r;
  }

  /** Qué producto miró el cliente. Se lanza y se olvida. */
  registrarClic(busquedaId: string | null, productId: number): void {
    if (!busquedaId) return;
    void this.pedir(`/recommender/busquedas/${encodeURIComponent(busquedaId)}/clic`, 'POST', { productId });
  }
}

/** `/health` del middleware, por el panel: lo más barato que responde. */
export async function estaVivo(): Promise<boolean> {
  const r = await enviar('/salud');
  return !!r?.ok;
}

// ── Activación ───────────────────────────────────────────────────────────────

const CLAVE_TOKEN = 'asta.activacion.token';

export const tokenGuardado = (): string | null => {
  const t = almacenNavegador.leer(CLAVE_TOKEN);
  return esTokenDeTablet(t) ? t : null;
};
export const olvidarToken = () => almacenNavegador.borrar(CLAVE_TOKEN);

export type ResultadoActivacion = { tipo: 'ACTIVADA'; token: string } | { tipo: 'FORMATO_INVALIDO' | 'RECHAZADO' | 'DEMASIADOS_INTENTOS' | 'SIN_CONEXION' };

/** «iPad · Safari», «Android · Chrome»: para reconocer la tablet en el panel. */
function modelo(): string {
  const ua = navigator.userAgent;
  const so = /iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1 ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : 'Otro';
  const nav = /EdgA?\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${so} · ${nav} · web`;
}

/** Manda el código al servidor y, si lo acepta, guarda el token que devuelve. */
export async function activar(texto: string): Promise<ResultadoActivacion> {
  const codigo = normalizarCodigo(texto);
  if (!codigo) return { tipo: 'FORMATO_INVALIDO' };
  const r = await enviar('/vincular', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Version': VERSION_WEB },
    body: JSON.stringify({ codigo, plataforma: 'web', modelo: modelo().slice(0, 100), version: VERSION_WEB }),
  });
  if (!r) return { tipo: 'SIN_CONEXION' };
  if (r.status === 201) {
    const cuerpo = (await r.json().catch(() => null)) as { data?: { token?: string } } | null;
    const token = cuerpo?.data?.token;
    if (!esTokenDeTablet(token)) return { tipo: 'SIN_CONEXION' };
    almacenNavegador.guardar(CLAVE_TOKEN, token);
    return { tipo: 'ACTIVADA', token };
  }
  if (r.status === 400 || r.status === 404) return { tipo: 'RECHAZADO' };
  if (r.status === 429) return { tipo: 'DEMASIADOS_INTENTOS' };
  return { tipo: 'SIN_CONEXION' };
}

// ── Datos con caché ──────────────────────────────────────────────────────────

export type Informe = 'OK' | 'SIN_RED' | 'SIN_ERP';
export type ConCache<T> = { ok: true; datos: T; guardadoEn: number | null } | { ok: false; motivo: MotivoFallo };

/** Lo vivo manda; lo guardado rescata solo sin red o sin ERP (un 403 no se tapa). */
export class Datos {
  constructor(
    readonly api: ClienteApi,
    private readonly cache: CacheLocal,
  ) {}

  private async conCache<T>(clave: string, informar: (i: Informe) => void, pedir: () => Promise<Resultado<T>>): Promise<ConCache<T>> {
    const r = await pedir();
    if (r.ok) {
      informar('OK');
      this.cache.guardar(clave, r.datos);
      return { ok: true, datos: r.datos, guardadoEn: null };
    }
    informar(r.motivo === 'RED' ? 'SIN_RED' : r.motivo === 'ERP' ? 'SIN_ERP' : 'OK');
    const rescata = r.motivo === 'RED' || r.motivo === 'ERP';
    const guardado = rescata ? this.cache.leer<T>(clave) : null;
    return guardado ? { ok: true, datos: guardado.datos, guardadoEn: guardado.guardadoEn } : { ok: false, motivo: r.motivo };
  }

  buscar(q: string, informar: (i: Informe) => void) {
    return this.conCache(claveBusqueda(q), informar, () => this.api.buscarImpresoras(q));
  }

  compatibles(impresoraId: number, busquedaId: string | null, informar: (i: Informe) => void) {
    return this.conCache(claveCompatibles(impresoraId), informar, () => this.api.compatiblesDe(impresoraId, busquedaId));
  }
}
