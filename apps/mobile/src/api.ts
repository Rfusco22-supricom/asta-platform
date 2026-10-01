/**
 * Cliente de la API pública para el kiosco (#40).
 *
 * ── Por qué una API key y no un token de dispositivo ─────────────────────────
 *
 * `kiosk_devices` guarda el hash de un token, pero no dice a qué almacén ni a
 * qué compañía pertenece la tablet, y la existencia que publica el recomendador
 * es la del almacén del cliente del token. Sin esa columna, un token de
 * dispositivo no puede responder "¿hay existencias?", que es la pregunta del
 * kiosco. Mientras tanto la tablet usa la API key de la tienda, con el permiso
 * `RECOMMENDER_READ` y nada más.
 *
 * La key se configura en `app.json` (`extra.apiKey`) al preparar la tablet. NO
 * se escribe en el repositorio.
 *
 * ── Errores ──────────────────────────────────────────────────────────────────
 *
 * `pedir` no lanza por un 4xx/5xx: devuelve un resultado que el llamante tiene
 * que mirar. En una pantalla de piso de venta, una excepción no capturada deja
 * la tablet en blanco delante del cliente.
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
  color: string | null;
  rendimientoPaginas: number | null;
}

export interface ProductoCompatible {
  id: number;
  templateId: number;
  sku: string | null;
  nombre: string;
  stock: EstadoStock;
  tipo: 'original' | 'compatible';
  cartuchos: Cartucho[];
}

export interface Busqueda {
  impresoras: Impresora[];
  sugerencias: Impresora[];
  /** Para enlazar búsqueda, impresora y producto en la telemetría (#43). */
  busquedaId: string | null;
}

/**
 * `erp` es su propio motivo, y no `servidor`: el middleware contestó y dijo que
 * el ERP no responde. Es el corte más probable —Odoo cae, la tienda tiene wifi—
 * y ahí la caché SÍ rescata, mientras que un 500 nuestro o un 403 no.
 */
export type MotivoFallo = 'red' | 'erp' | 'servidor' | 'permiso';

export type Resultado<T> = { ok: true; datos: T } | { ok: false; motivo: MotivoFallo; estado?: number };

export interface Config {
  base: string;
  apiKey: string;
  /** Inyectable para los tests. */
  fetch?: typeof fetch;
}

/** El 503 del middleware cuando Odoo no responde (`ODOO_UNAVAILABLE`). */
async function esErpCaido(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try {
    const cuerpo = (await res.clone().json()) as { error?: { code?: string } };
    return cuerpo.error?.code === 'ODOO_UNAVAILABLE';
  } catch {
    return false;
  }
}

async function pedir<T>(config: Config, ruta: string, opciones: RequestInit = {}): Promise<Resultado<T>> {
  const f = config.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${config.base}${ruta}`, {
      ...opciones,
      headers: { 'X-API-Key': config.apiKey, ...(opciones.body ? { 'Content-Type': 'application/json' } : {}), ...opciones.headers },
    });
  } catch {
    // Sin conexión, o el servidor no responde. Lo distingue la pantalla para
    // decir "sin conexión" en vez de "error".
    return { ok: false, motivo: 'red' };
  }

  if (res.status === 401 || res.status === 403) return { ok: false, motivo: 'permiso', estado: res.status };
  if (!res.ok) return { ok: false, motivo: (await esErpCaido(res)) ? 'erp' : 'servidor', estado: res.status };
  if (res.status === 204) return { ok: true, datos: undefined as T };

  try {
    return { ok: true, datos: (await res.json()) as T };
  } catch {
    return { ok: false, motivo: 'servidor', estado: res.status };
  }
}

export async function buscarImpresoras(config: Config, q: string): Promise<Resultado<Busqueda>> {
  const r = await pedir<{ data: Impresora[]; sugerencias: Impresora[]; meta: { busquedaId: string | null } }>(
    config,
    `/api/v1/public/recommender/printers?q=${encodeURIComponent(q)}&limit=12`,
  );
  if (!r.ok) return r;
  return { ok: true, datos: { impresoras: r.datos.data, sugerencias: r.datos.sugerencias, busquedaId: r.datos.meta.busquedaId } };
}

export async function compatiblesDe(config: Config, impresoraId: number, busquedaId: string | null): Promise<Resultado<ProductoCompatible[]>> {
  const q = busquedaId ? `?busquedaId=${encodeURIComponent(busquedaId)}` : '';
  const r = await pedir<{ data: ProductoCompatible[] }>(config, `/api/v1/public/recommender/printers/${impresoraId}/compatible${q}`);
  return r.ok ? { ok: true, datos: r.datos.data } : r;
}

/**
 * Avisa de qué producto miró el cliente (#43). Se lanza y se olvida: que la
 * telemetría falle no puede estropear lo que el cliente está haciendo.
 */
export function registrarClic(config: Config, busquedaId: string | null, productId: number): void {
  if (!busquedaId) return;
  void pedir(config, `/api/v1/public/recommender/busquedas/${busquedaId}/clic`, {
    method: 'POST',
    body: JSON.stringify({ productId }),
  });
}
