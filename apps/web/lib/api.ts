import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  sesionesRespuestaSchema,
  type SesionActiva,
  portfolioRowSchema,
  portfolioMetaSchema,
  invoicingSummarySchema,
  clientProfileSchema,
  apiErrorSchema,
  apiKeySummarySchema,
  agentesRespuestaSchema,
  astaRespuestaSchema,
  reporteRespuestaSchema,
  type ReporteRespuesta,
  hermanosRespuestaSchema,
  revisionRespuestaSchema,
  type RevisionRespuesta,
  type Hermano,
  type OportunidadAsta,
  type Agente,
  type ApiKeySummary,
  type PortfolioRow,
  type PortfolioMeta,
  type InvoicingSummary,
  type ClientProfile,
} from '@asta/shared-types';

/**
 * Cliente del middleware.
 *
 * SOLO SE USA DESDE EL SERVIDOR (Server Components y Route Handlers).
 *
 * Que el navegador no hable nunca con el middleware tiene tres consecuencias
 * que valen la pena:
 *
 *   · El token de sesión no llega al cliente. No hay nada que robar con XSS.
 *   · CORS deja de existir como problema: es una llamada servidor a servidor.
 *   · La URL del middleware no se publica. Solo Next sabe dónde está.
 *
 * Cada respuesta se valida contra el contrato de `@asta/shared-types`. Si el
 * middleware cambia la forma de un endpoint, el panel falla aquí, con un
 * mensaje que dice qué campo, en vez de reventar al pintar con un `undefined`.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * ¿Es esto la excepción que usa Next para redirigir?
 *
 * `redirect()` funciona LANZANDO. Eso choca con las páginas, que envuelven sus
 * llamadas en try/catch para enseñar un aviso decente cuando algo falla: sin
 * esta comprobación, el catch se traga la redirección y el usuario se queda
 * mirando "no se pudo cargar" en vez de ir al login.
 *
 * Se mira el `digest` porque es lo que Next pone en esa excepción; no hay una
 * comprobación pública mejor. Todo catch que envuelva una llamada a la API tiene
 * que empezar por relanzar si esto es true.
 */
export function esRedireccion(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/** Cuando el contrato y la respuesta no coinciden. Es un bug, no un fallo de red. */
export class ContractError extends Error {
  constructor(
    readonly endpoint: string,
    readonly detail: string,
  ) {
    super(`La respuesta de ${endpoint} no cumple el contrato: ${detail}`);
    this.name = 'ContractError';
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  accessToken: string,
): Promise<z.infer<T>> {
  let res: Response;

  try {
    res = await fetch(`${MIDDLEWARE_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      /**
       * SIN caché. Nunca.
       *
       * Empezó como `revalidate: 30` para no repetir la consulta de cartera,
       * que tarda ~2 s. Dos problemas, y el segundo es el grave:
       *
       *   1. Al escribir una nota, `router.refresh()` volvía a pintar la página
       *      con la respuesta cacheada y el vendedor no veía lo que acababa de
       *      guardar. Parecía que se había perdido.
       *
       *   2. La Data Cache de Next se comparte entre TODOS los visitantes del
       *      servidor. Estas respuestas son datos de UN vendedor concreto,
       *      autorizados por su token. Depender de que la clave de caché
       *      incluya la cabecera de autorización para que no se mezclen es
       *      apoyar el aislamiento entre clientes en un detalle de
       *      implementación del framework. Sin RLS detrás (#44), no.
       *
       * Los 2 s de la cartera se pagan. Si algún día molestan, la solución es
       * cachear en el middleware por identidad, no aquí.
       */
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('NETWORK', 'No se pudo contactar con el middleware.', 503);
  }

  const body = await res.json().catch(() => null);

  /*
   * Sesión muerta: al login, no a una pantalla de error.
   *
   * Pasa cuando la sesión se cerró en otro sitio —desde la pantalla de sesiones
   * activas (#52), al cambiar la contraseña, o por detección de reuso del
   * refresh token—. La cookie local sigue existiendo, así que `requireSession()`
   * deja pasar y es el middleware quien rechaza.
   *
   * Antes cada página enseñaba su propio "no se pudo cargar" con un botón de
   * Salir: un callejón sin salida, y encima distinto en cada pantalla. Se
   * resuelve aquí, en el único sitio por el que pasan todas.
   *
   * No se borra la cookie de paso: modificarla desde el render de un Server
   * Component lo prohíbe Next. La siguiente entrada la sobrescribe igualmente.
   */
  if (res.status === 401) redirect('/login?error=cerrada');

  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    if (err.success) throw new ApiError(err.data.error.code, err.data.error.message, res.status);
    throw new ApiError('UNKNOWN', `El middleware devolvió ${res.status}.`, res.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(path, z.prettifyError(parsed.error).slice(0, 300));
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────

const portfolioSchema = z.object({
  data: z.array(portfolioRowSchema),
  meta: portfolioMetaSchema,
});

export interface Portfolio {
  filas: PortfolioRow[];
  meta: PortfolioMeta;
}

export async function getPortfolio(accessToken: string): Promise<Portfolio> {
  const r = await request('/api/v1/salesperson/portfolio', portfolioSchema, accessToken);
  return { filas: r.data, meta: r.meta };
}

const invoicingSchema = z.object({
  data: z.object({
    cliente: z.object({
      id: z.number(),
      nombre: z.string().optional(),
      tier: z.string().nullable().optional(),
    }),
    facturacion: invoicingSummarySchema,
  }),
  meta: z.looseObject({}),
});

export interface ClientInvoicing {
  cliente: { id: number; nombre?: string; tier?: string | null };
  facturacion: InvoicingSummary;
}

export interface InvoicingOptions {
  serieMensual?: boolean;
  desde?: string;
  hasta?: string;
  incluirNotasDeCredito?: boolean;
}

export async function getClientInvoicing(
  accessToken: string,
  partnerId: number,
  opciones: InvoicingOptions = {},
): Promise<ClientInvoicing> {
  const qs = new URLSearchParams();
  if (opciones.serieMensual) qs.set('incluirSerieMensual', 'true');
  if (opciones.desde) qs.set('desde', opciones.desde);
  if (opciones.hasta) qs.set('hasta', opciones.hasta);
  if (opciones.incluirNotasDeCredito) qs.set('incluirNotasDeCredito', 'true');

  const sufijo = qs.size > 0 ? `?${qs}` : '';
  const r = await request(
    `/api/v1/salesperson/clients/${partnerId}/invoicing${sufijo}`,
    invoicingSchema,
    accessToken,
  );
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  data: clientProfileSchema,
  meta: z.looseObject({}),
});

export async function getClientProfile(
  accessToken: string,
  partnerId: number,
): Promise<ClientProfile> {
  const r = await request(
    `/api/v1/salesperson/clients/${partnerId}/profile`,
    profileSchema,
    accessToken,
  );
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Informe de reconciliación.
 *
 * Se tipa con `looseObject` en vez de reproducir la forma entera: es un informe
 * de operación que va a crecer, y obligar a tocar dos sitios por cada campo
 * nuevo no aporta nada aquí. Los contratos estrictos están donde importan —los
 * datos de negocio que pinta el panel del vendedor.
 */
const reconciliacionSchema = z.object({
  data: z.looseObject({
    generadoEn: z.string(),
    odoo: z.looseObject({ clientesActivos: z.number() }),
    middleware: z.looseObject({
      usuarios: z.number(),
      clientes: z.number(),
      staff: z.number(),
    }),
    sinCuenta: z.looseObject({ total: z.number() }),
    sinCredenciales: z.looseObject({ total: z.number() }),
    huerfanos: z.looseObject({ total: z.number() }),
    desalineados: z.looseObject({ total: z.number() }),
    nuncaSincronizados: z.looseObject({ total: z.number() }),
    duracionMs: z.number(),
  }),
});

export type Reconciliacion = z.infer<typeof reconciliacionSchema>['data'];

export async function getReconciliacion(accessToken: string): Promise<Reconciliacion> {
  const r = await request('/api/v1/admin/reconciliation', reconciliacionSchema, accessToken);
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────────────

const sinAccesoSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      nombre: z.string(),
      role: z.string(),
      invitacionPendiente: z.boolean(),
    }),
  ),
  meta: z.object({
    total: z.number().int().nonnegative(),
    mostrados: z.number().int().nonnegative(),
  }),
});

export type CandidatoInvitacion = z.infer<typeof sinAccesoSchema>['data'][number];

export interface SinAcceso {
  filas: CandidatoInvitacion[];
  /** Cuántos hay EN TOTAL, no cuántos se muestran. Ver la nota del servicio. */
  total: number;
}

export async function getSinAcceso(accessToken: string, limite = 25): Promise<SinAcceso> {
  const r = await request(
    `/api/v1/admin/users/without-access?limit=${limite}`,
    sinAccesoSchema,
    accessToken,
  );
  return { filas: r.data, total: r.meta.total };
}

// ─────────────────────────────────────────────────────────────────────────────

const apiKeysSchema = z.object({
  data: z.array(apiKeySummarySchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    vivas: z.number().int().nonnegative(),
    maximo: z.number().int().positive(),
  }),
});

export interface MisApiKeys {
  filas: ApiKeySummary[];
  vivas: number;
  maximo: number;
}

/** Las API keys del cliente que pide (issue #28). */
export async function getApiKeys(accessToken: string): Promise<MisApiKeys> {
  const r = await request('/api/v1/account/api-keys', apiKeysSchema, accessToken);
  return { filas: r.data, vivas: r.meta.vivas, maximo: r.meta.maximo };
}

export interface Sesiones {
  filas: SesionActiva[];
  total: number;
  otras: number;
}

/** Sesiones activas del usuario que pide (issue #52). */
export async function getSesiones(accessToken: string): Promise<Sesiones> {
  const r = await request('/api/v1/auth/sessions', sesionesRespuestaSchema, accessToken);
  return { filas: r.data, total: r.meta.total, otras: r.meta.otras };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Agentes {
  filas: Agente[];
  totales: {
    agentes: number;
    clientes: number;
    facturado: number;
    porCobrar: number;
    sinAcceso: number;
  };
  generadoEn: string;
  duracionMs: number;
}

/** Estadísticas de los agentes de venta (#96). */
export async function getAgentes(accessToken: string): Promise<Agentes> {
  const r = await request('/api/v1/admin/agentes', agentesRespuestaSchema, accessToken);
  const { generadoEn, duracionMs, ...totales } = r.meta;
  return { filas: r.data, totales, generadoEn, duracionMs };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Asta {
  filas: OportunidadAsta[];
  totales: {
    clientes: number;
    asta: number;
    competencia: number;
    cuota: number;
    sinAsta: number;
    sinAstaImporte: number;
  };
  generadoEn: string;
  duracionMs: number;
}

/**
 * Cuota de ASTA frente a la competencia.
 *
 * Dos rutas distintas y no una con parámetro: la del administrador devuelve
 * toda la empresa, la del vendedor solo su cartera. El alcance lo fija el
 * endpoint, no quien llama.
 */
async function pedirAsta(ruta: string, accessToken: string): Promise<Asta> {
  const r = await request(ruta, astaRespuestaSchema, accessToken);
  const { generadoEn, duracionMs, ...totales } = r.meta;
  return { filas: r.data, totales, generadoEn, duracionMs };
}

export const getAstaEmpresa = (accessToken: string) => pedirAsta('/api/v1/admin/asta', accessToken);
export const getAstaCartera = (accessToken: string) =>
  pedirAsta('/api/v1/salesperson/asta', accessToken);

// ─────────────────────────────────────────────────────────────────────────────

export type Reporte = ReporteRespuesta;

/**
 * Reportes de facturacion.
 *
 * Igual que ASTA: dos rutas, no una con parametro. La del vendedor devuelve
 * `porVendedor: null` porque ni siquiera calcula ese corte, asi que no hay forma
 * de que la pantalla ensene de mas por un fallo de plantilla.
 */
async function pedirReporte(
  ruta: string,
  accessToken: string,
  rango?: { desde: string; hasta: string },
): Promise<Reporte> {
  const qs = rango ? `?desde=${rango.desde}&hasta=${rango.hasta}` : '';
  return request(`${ruta}${qs}`, reporteRespuestaSchema, accessToken);
}

export const getReporteEmpresa = (
  accessToken: string,
  rango?: { desde: string; hasta: string },
) => pedirReporte('/api/v1/admin/reportes', accessToken, rango);

export const getReporteCartera = (
  accessToken: string,
  rango?: { desde: string; hasta: string },
) => pedirReporte('/api/v1/salesperson/reportes', accessToken, rango);

// ─────────────────────────────────────────────────────────────────────────────

export interface Duplicados {
  esteRegistro: number;
  total: number;
  hermanos: Hermano[];
}

/** Otros registros del mismo cliente en Odoo (#50). */
export async function getDuplicados(accessToken: string, partnerId: number): Promise<Duplicados> {
  const r = await request(
    `/api/v1/salesperson/clients/${partnerId}/duplicados`,
    hermanosRespuestaSchema,
    accessToken,
  );
  return r.data;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Propuestas producto → cartucho para revisar (#56). */
export async function getRevisionCompatibilidades(
  accessToken: string,
  filtro: { estado?: string; marca?: string; q?: string; pagina?: number },
): Promise<RevisionRespuesta> {
  const qs = new URLSearchParams();
  if (filtro.estado) qs.set('estado', filtro.estado);
  if (filtro.marca) qs.set('marca', filtro.marca);
  if (filtro.q) qs.set('q', filtro.q);
  if (filtro.pagina && filtro.pagina > 1) qs.set('pagina', String(filtro.pagina));
  const sufijo = qs.size ? `?${qs.toString()}` : '';
  return request(`/api/v1/admin/compatibilidades/productos${sufijo}`, revisionRespuestaSchema, accessToken);
}
