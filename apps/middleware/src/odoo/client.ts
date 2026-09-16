import xmlrpc from 'xmlrpc';
import { URL } from 'node:url';
import { odooEnv as env } from '../config/odooEnv.js';
import { odooLogger } from '../utils/logger.js';
import { registrarRpc } from './metrics.js';

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

/** Odoo no contestó: ni sí ni no. No es lo mismo que una contraseña incorrecta. */
export class OdooNoDisponible extends Error {
  constructor() {
    super('Odoo no respondió al comprobar la contraseña');
    this.name = 'OdooNoDisponible';
  }
}

/**
 * ¿Es `password` la contraseña de Odoo de `login`? Devuelve el uid, o `false`.
 *
 * Lo usa el login del personal (#85). Es la ÚNICA función del middleware por la
 * que pasa una contraseña de Odoo que no es la del usuario de servicio, así que:
 *
 *   · no registra nada: ni la contraseña, ni el login, ni los parámetros. Los
 *     errores se relanzan como `OdooNoDisponible`, sin el error original, que
 *     en algunas librerías XML-RPC incluye el cuerpo de la petición.
 *   · no toca `uidPromise`: autenticar a una persona no puede cambiar la sesión
 *     del usuario de servicio.
 *   · no pasa por `registrarRpc`, para que las métricas no mezclen logins con
 *     lecturas.
 *
 * Con la verificación en dos pasos activada, Odoo responde `false` aunque la
 * contraseña sea buena: no hay forma de distinguirlo desde aquí.
 */
export async function autenticarEnOdoo(login: string, password: string): Promise<number | false> {
  try {
    const uid = await call<number | false>(commonClient, 'authenticate', [env.ODOO_DB, login, password, {}]);
    return typeof uid === 'number' && uid > 0 ? uid : false;
  } catch (error) {
    // Un fallo XML-RPC con `faultCode` es Odoo contestando que no: por ejemplo su
    // propio freno tras varios intentos («Too many login failures»). Eso es un
    // rechazo, no una caída, y no debe decirle al usuario que Odoo no responde.
    if (error && typeof error === 'object' && 'faultCode' in error) return false;
    throw new OdooNoDisponible();
  }
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
  {
    retryOnAuthFailure = true,
    /**
     * Si esta llamada cuenta para la ventana de latencia (issue #46).
     *
     * La sonda de `/health` pasa `medir: false`. Si contara, un monitor que
     * consulta el health cada 30 s llenaría la ventana con una llamada trivial
     * (`res.users.search_count`) y el p95 saldría estupendo aunque el panel
     * fuera lentísimo. La alerta mediría la sonda, no el sistema.
     */
    medir = true,
  }: { retryOnAuthFailure?: boolean; medir?: boolean } = {},
): Promise<T> {
  const uid = await getUid();

  const context = {
    lang: env.ODOO_DEFAULT_LANG,
    tz: env.ODOO_DEFAULT_TZ,
    ...kwargs.context,
  };

  const t0 = performance.now();
  const transcurrido = () => Math.round(performance.now() - t0);

  try {
    const resultado = await call<T>(objectClient, 'execute_kw', [
      env.ODOO_DB,
      uid,
      env.ODOO_PASSWORD,
      model,
      method,
      args,
      { ...kwargs, context },
    ]);

    const ms = transcurrido();

    /*
     * Las lentas van a `warn` y el resto a `debug`.
     *
     * Con todo en `info` esto sería inservible: una sola carga de cartera son
     * dos RPC y la batería de aislamiento dispara cientos. Así, en producción
     * con LOG_LEVEL=info solo aparecen las llamadas que de verdad arrastran,
     * que es justo lo que se busca cuando alguien dice que el panel va lento.
     *
     * NUNCA se registran los argumentos. El tercer parámetro de `execute_kw`
     * es la API key del usuario de servicio, y los dominios llevan datos de
     * clientes reales. Con modelo, método y milisegundos sobra para saber qué
     * llamada hay que mirar.
     */
    // Además del log, a la ventana en memoria: el log no se consulta, y el p95
    // que dispara la alerta de #46 tiene que salir de algún sitio.
    if (medir) registrarRpc(ms, true);

    const lenta = ms >= env.ODOO_SLOW_RPC_MS;
    odooLogger[lenta ? 'warn' : 'debug'](
      { model, method, ms, lenta },
      `odoo ${model}.${method} ${ms}ms`,
    );

    return resultado;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ms = transcurrido();

    // La sesión del usuario de servicio caducó (reinicio de Odoo, cambio de pwd):
    // se reintenta UNA vez con uid fresco.
    if (retryOnAuthFailure && /AccessDenied|Session expired|Invalid.*uid/i.test(message)) {
      // En `warn`, no en `debug`: si esto empieza a salir seguido es que alguien
      // está tocando el usuario de servicio en Odoo, y conviene enterarse.
      odooLogger.warn(
        { model, method, ms, reintento: true },
        `odoo ${model}.${method}: sesión caducada, reintentando con uid fresco`,
      );
      invalidateUid();
      return executeKw<T>(model, method, args, kwargs, { retryOnAuthFailure: false, medir });
    }

    // Los fallos también cuentan: una tanda de errores rápidos bajaría el p95 y
    // haría parecer que Odoo va mejor que nunca justo cuando está roto.
    if (medir) registrarRpc(ms, false);

    odooLogger.error(
      // Recortado: el mensaje de Odoo puede traer una traza entera. Sin
      // argumentos, por lo mismo de arriba.
      { model, method, ms, error: message.slice(0, 300) },
      `odoo ${model}.${method} falló tras ${ms}ms`,
    );

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
