import xmlrpc from 'xmlrpc';
import { URL } from 'node:url';
import { env } from '../config/env.js';

/**
 * Cliente XML-RPC de Odoo.
 *
 * Un único usuario de servicio para todo el middleware. La identidad del cliente
 * final NUNCA se traduce a un usuario de Odoo: el aislamiento de datos se aplica
 * en el `domain` que arma la capa de servicio (ver services/*.service.ts).
 *
 * Odoo expone dos endpoints XML-RPC:
 *   /xmlrpc/2/common  -> authenticate, version
 *   /xmlrpc/2/object  -> execute_kw (todo lo demás)
 */

type XmlRpcClient = ReturnType<typeof xmlrpc.createClient>;

export type OdooDomain = Array<[string, string, unknown] | '&' | '|' | '!'>;

export interface ExecuteKwOptions {
  /** Contexto de Odoo: lang, tz, pricelist, allowed_company_ids, ... */
  context?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
  groupby?: string[];
  /** En read_group, `lazy: false` agrupa por TODOS los campos a la vez. */
  lazy?: boolean;
  [key: string]: unknown;
}

class OdooError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly method: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OdooError';
  }
}

function buildClient(path: string): XmlRpcClient {
  const url = new URL(path, env.ODOO_URL);
  const options = {
    url: url.toString(),
    // Odoo cierra conexiones ociosas; keep-alive evita el handshake TLS por request.
    headers: { 'User-Agent': 'asta-middleware/1.0' },
  };
  return url.protocol === 'https:'
    ? xmlrpc.createSecureClient(options)
    : xmlrpc.createClient(options);
}

/** xmlrpc es callback-based; lo envolvemos en promesa con timeout propio. */
function call<T>(client: XmlRpcClient, method: string, params: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Odoo RPC timeout tras ${env.ODOO_TIMEOUT_MS} ms (${method})`)),
      env.ODOO_TIMEOUT_MS,
    );

    client.methodCall(method, params, (error: unknown, value: T) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    });
  });
}

const commonClient = buildClient('/xmlrpc/2/common');
const objectClient = buildClient('/xmlrpc/2/object');

/**
 * El uid del usuario de servicio no cambia. Autenticar en cada request sería un
 * round-trip extra al ERP por llamada, así que se cachea el promise (no el valor)
 * para que N requests concurrentes en arranque en frío compartan un solo login.
 */
let uidPromise: Promise<number> | null = null;

export async function getUid(): Promise<number> {
  if (!uidPromise) {
    uidPromise = call<number | false>(commonClient, 'authenticate', [
      env.ODOO_DB,
      env.ODOO_USERNAME,
      env.ODOO_PASSWORD,
      {},
    ]).then((uid) => {
      if (!uid) {
        uidPromise = null; // permite reintentar en el próximo request
        throw new Error('Odoo rechazó las credenciales del usuario de servicio');
      }
      return uid;
    }).catch((err) => {
      uidPromise = null;
      throw err;
    });
  }
  return uidPromise;
}

/** Fuerza un re-login. Se llama cuando Odoo responde AccessDenied a mitad de vuelo. */
export function invalidateUid(): void {
  uidPromise = null;
}

/**
 * Envoltorio de `execute_kw`, la única puerta al ERP.
 *
 * @example
 *   await executeKw<number[]>('res.partner', 'search', [[['is_company','=',true]]], { limit: 10 })
 */
export async function executeKw<T = unknown>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: ExecuteKwOptions = {},
  { retryOnAuthFailure = true }: { retryOnAuthFailure?: boolean } = {},
): Promise<T> {
  const uid = await getUid();

  const context = {
    lang: env.ODOO_DEFAULT_LANG,
    tz: env.ODOO_DEFAULT_TZ,
    ...kwargs.context,
  };

  try {
    return await call<T>(objectClient, 'execute_kw', [
      env.ODOO_DB,
      uid,
      env.ODOO_PASSWORD,
      model,
      method,
      args,
      { ...kwargs, context },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // La sesión del usuario de servicio caducó (reinicio de Odoo, cambio de pwd):
    // se reintenta UNA vez con uid fresco.
    if (retryOnAuthFailure && /AccessDenied|Session expired|Invalid.*uid/i.test(message)) {
      invalidateUid();
      return executeKw<T>(model, method, args, kwargs, { retryOnAuthFailure: false });
    }

    throw new OdooError(`Fallo en ${model}.${method}: ${message}`, model, method, error);
  }
}

/** Helper tipado para search_read, el 80 % de las llamadas. */
export function searchRead<T = Record<string, unknown>>(
  model: string,
  domain: OdooDomain,
  fields: string[],
  options: Omit<ExecuteKwOptions, 'fields'> = {},
): Promise<T[]> {
  return executeKw<T[]>(model, 'search_read', [domain], { fields, ...options });
}

/** Agregación del lado de Odoo/Postgres. Devuelve grupos, no registros. */
export function readGroup<T = Record<string, unknown>>(
  model: string,
  domain: OdooDomain,
  fields: string[],
  groupby: string[],
  options: Omit<ExecuteKwOptions, 'fields' | 'groupby'> = {},
): Promise<T[]> {
  return executeKw<T[]>(model, 'read_group', [domain, fields, groupby], {
    lazy: false,
    ...options,
  });
}

export { OdooError };
