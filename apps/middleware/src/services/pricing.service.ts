import type { ErrorCode, PublicPrice } from '@asta/shared-types';
import { searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { anotarCacheHit } from '../utils/contextoPeticion.js';
import { leerTarifasConCompania } from './tarifas.service.js';

/**
 * Precios de la API pública (#31): cada cliente ve el de SU tarifa.
 *
 * ── De dónde sale la tarifa ──────────────────────────────────────────────────
 *
 * Del partner de la API key, leída en Odoo desde la compañía del cliente
 * (`leerTarifasConCompania`), como la resuelve Odoo al crearle un pedido. Nunca
 * de la petición: no existe parámetro que la elija, y mandar uno es un 400
 * auditado (`TarifaForzada`).
 *
 * No se usa `identity.odooPricelistId`, aunque #31 lo proponía. Es una copia
 * que hace el sync, así que va por detrás de Odoo por definición, y hasta #31
 * se leía mal: llevaba la tarifa de la compañía 9 para dos tercios de los
 * clientes (ver `tarifas.service.ts`). Si discrepa de lo que dice Odoo se
 * avisa en el log, pero manda Odoo.
 *
 * Y aun leída de Odoo, se comprueba antes de usarla (`validarTarifa`): tiene que
 * estar ACTIVA y ser de la compañía del cliente o de ninguna. Hay 7 archivadas
 * con el 47 % de las reglas —precios que el negocio retiró— y 7 compañías.
 *
 * ── Cómo se calcula ──────────────────────────────────────────────────────────
 *
 * Leyendo las reglas (`product.pricelist.item`). En Odoo 17 no hay método
 * público que calcule el precio de una tarifa (`price` ya no existe,
 * `lst_price` ignora la tarifa, `_get_product_price` es privado: #5), y leer las
 * reglas permite pedir 100 referencias en una sola lectura.
 *
 * Se elige la regla como Odoo (`_order = applied_on, min_quantity desc, id
 * desc`, la primera aplicable): la de variante antes que la de producto, y entre
 * iguales la más reciente. Aplicable = vigente hoy y con `min_quantity` ≤ 1,
 * porque se cotiza la unidad.
 *
 * Solo se publican reglas de precio FIJO a nivel de producto o variante: son
 * 35.055 de 35.056. Lo que no sabemos calcular —una fórmula, un descuento, una
 * regla por categoría o global— sale `sin_precio_en_tarifa`, nunca aproximado.
 * Un hueco se ve; un precio equivocado se cobra.
 *
 * `precios.test.ts` contrasta cada precio contra el que el propio Odoo pondría
 * en un pedido (`sale.order.onchange`), que es un camino independiente de este.
 */

/** Una tarifa lista para dar precios a un cliente concreto. */
export interface TarifaCliente {
  pricelistId: number;
  companyId: number;
  /** Código ISO de la moneda de la tarifa: USD, VEF, PAB. */
  moneda: string;
}

/**
 * El cliente no tiene una tarifa válida.
 *
 * Se lanza en vez de responder desde el controlador, igual que
 * `InventarioNoDisponible`: el status lo pone `errorHandler`.
 */
export class TarifaNoDisponible extends Error {
  readonly status = 409;
  readonly code: ErrorCode = 'PRICELIST_UNAVAILABLE';

  constructor(
    readonly partnerId: number,
    /** Para el log, no para el cliente. */
    readonly motivo: 'sin_compania' | 'sin_tarifa' | 'tarifa_inactiva' | 'tarifa_de_otra_compania',
  ) {
    // Este mensaje SÍ sale al cliente: sin mencionar compañías ni tarifas de Odoo.
    super('La cuenta no tiene una tarifa de precios asignada. Contacta con tu vendedor.');
    this.name = 'TarifaNoDisponible';
  }
}

/** La petición intenta elegir tarifa o compañía. */
export class TarifaForzada extends Error {
  readonly status = 400;
  readonly code: ErrorCode = 'PRICELIST_NOT_ALLOWED';

  constructor(readonly parametros: string[]) {
    super('La tarifa no se puede elegir: sale siempre de la API key. Quita el parámetro.');
    this.name = 'TarifaForzada';
  }
}

/**
 * Parámetros que intentan elegir la tarifa o la compañía.
 *
 * Por nombre y no por lista cerrada: `pricelist`, `pricelist_id`, `pricelistId`,
 * `tarifa`, `context[pricelist]`, `company_id`, `allowed_company_ids`… Ninguno
 * lo lee el endpoint, así que ignorarlos ya daría el precio correcto; se
 * rechazan para que el intento quede a la vista (#31: «cada intento de forzar
 * una tarifa queda auditado»), igual que `partner_id` en `scopeToOwnPartner`.
 */
const PARAMETRO_DE_TARIFA = /pricelist|price_list|tarifa|lista|context|compan/i;

export function parametrosDeTarifa(entrada: Record<string, unknown> | undefined): string[] {
  return Object.keys(entrada ?? {}).filter((k) => PARAMETRO_DE_TARIFA.test(k));
}

// ─────────────────────────────────────────────────────────────────────────────
// La tarifa del cliente
// ─────────────────────────────────────────────────────────────────────────────

type Resolucion = { ok: true; tarifa: TarifaCliente } | { ok: false; motivo: TarifaNoDisponible['motivo'] };

/** En cache, con el partner comercial: para invalidar cuando cambia él (#34). */
type ResolucionEnCache = Resolucion & { raizId: number };

/** 10 min, como el almacén de `/inventory`: la tarifa de un cliente cambia rara vez. */
const cacheTarifas = new CacheTtl<ResolucionEnCache>(10 * 60_000, 5_000);

/**
 * Los precios. 5 min, lo que pide #31.
 *
 * La clave lleva la TARIFA y la compañía, además de la referencia. Sin la
 * tarifa, el primer cliente que pide un SKU fija el precio que ven durante
 * 5 minutos todos los demás. Es la fuga que prueba `precios.test.ts` pidiendo
 * lo mismo con dos keys seguidas.
 *
 * Una entrada por referencia, no por consulta: dos lotes que comparten SKUs
 * comparten cache. Se guardan también los «sin precio», o repetir una
 * referencia inventada sería una lectura a Odoo gratis cada vez.
 */
/** Exportada porque la guía pública la cita (#35). */
export const TTL_CACHE_PRECIOS_MS = 5 * 60_000;
const cachePrecios = new CacheTtl<Omit<PublicPrice, 'sku'>>(TTL_CACHE_PRECIOS_MS, 50_000);

/** Solo para tests. */
export function vaciarCachesPrecios(): void {
  cacheTarifas.vaciar();
  cachePrecios.vaciar();
}

// ── Invalidación (#34) ───────────────────────────────────────────────────────
// La llama `vigilanteCambios.ts` cuando Odoo dice que algo cambió. Borra solo lo
// afectado: el TTL sigue siendo el tope, esto solo lo adelanta.

/** Cambió una tarifa o alguna de sus reglas. */
export function invalidarPreciosDeTarifas(pricelistIds: ReadonlySet<number>): number {
  return (
    cachePrecios.borrarSi((clave) => pricelistIds.has((JSON.parse(clave) as [number])[0])) +
    // La validación de la tarifa también: puede haberse archivado o cambiado de compañía.
    cacheTarifas.borrarSi((_, r) => r.ok && pricelistIds.has(r.tarifa.pricelistId))
  );
}

/**
 * Cambió un producto: su referencia, si se vende, si está archivado.
 *
 * Van también todas las entradas SIN producto (`sku_no_encontrado`,
 * `sku_ambiguo`): el cambio puede ser justo que ahora esa referencia exista.
 */
export function invalidarPreciosDeProductos(productIds: ReadonlySet<number>): number {
  return cachePrecios.borrarSi((_, p) => p.productId === null || productIds.has(p.productId));
}

/** Cambió un cliente o su empresa: su tarifa o su compañía pueden ser otras. */
export function invalidarTarifasDeClientes(partnerIds: ReadonlySet<number>): number {
  return cacheTarifas.borrarSi((clave, r) => partnerIds.has(Number(clave)) || partnerIds.has(r.raizId));
}

interface Log {
  warn: (obj: unknown, msg?: string) => void;
}

/**
 * La tarifa con la que se le dan precios a un cliente, o `TarifaNoDisponible`.
 *
 * @param enIdentidad la que copió el sync, solo para avisar si discrepa.
 */
export async function tarifaDelCliente(partnerId: number, enIdentidad: number | null, log?: Log): Promise<TarifaCliente> {
  const clave = String(partnerId);
  let r = cacheTarifas.get(clave);
  if (!r) {
    r = await resolverTarifa(partnerId);
    cacheTarifas.set(clave, r);
  }
  // Solo la tarifa sale de cache aquí: el hit de la petición lo decide `preciosDe`.

  if (!r.ok) {
    log?.warn({ partnerId, motivo: r.motivo }, 'precios: el cliente no tiene una tarifa válida');
    throw new TarifaNoDisponible(partnerId, r.motivo);
  }
  if (enIdentidad !== r.tarifa.pricelistId) {
    log?.warn(
      { partnerId, enIdentidad, enOdoo: r.tarifa.pricelistId },
      'precios: la tarifa copiada por el sync no coincide con la de Odoo; se usa la de Odoo',
    );
  }
  return r.tarifa;
}

async function resolverTarifa(partnerId: number): Promise<ResolucionEnCache> {
  const leida = (await leerTarifasConCompania([partnerId])).get(partnerId);
  const raizId = leida?.raizId ?? partnerId;
  if (!leida?.companyId) return { ok: false, motivo: 'sin_compania', raizId };
  if (!leida.tarifa) return { ok: false, motivo: 'sin_tarifa', raizId };
  return { ...(await validarTarifa(leida.tarifa[0], leida.companyId)), raizId };
}

/**
 * Comprueba que una tarifa se puede usar para un cliente de `companyId`.
 *
 * Exportada para los tests: es la barrera que impide servir una tarifa
 * archivada o de otra compañía, y se prueba por separado de cómo se llegó a ese
 * id.
 */
export async function validarTarifa(pricelistId: number, companyId: number): Promise<Resolucion> {
  // Sin `active_test: false`: una archivada no aparece, y así debe ser.
  const [tarifa] = await searchRead<{ id: number; company_id: [number, string] | false; currency_id: [number, string] }>(
    'product.pricelist',
    [['id', '=', pricelistId]],
    ['company_id', 'currency_id'],
    { context: { allowed_company_ids: [companyId] } },
  );
  if (!tarifa) return { ok: false, motivo: 'tarifa_inactiva' };
  if (tarifa.company_id && tarifa.company_id[0] !== companyId) return { ok: false, motivo: 'tarifa_de_otra_compania' };
  return { ok: true, tarifa: { pricelistId, companyId, moneda: tarifa.currency_id[1] } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Los precios
// ─────────────────────────────────────────────────────────────────────────────

interface Producto {
  id: number;
  default_code: string;
  product_tmpl_id: [number, string];
}

export interface Regla {
  id: number;
  applied_on: string;
  compute_price: string;
  fixed_price: number;
  product_id: [number, string] | false;
  product_tmpl_id: [number, string] | false;
  min_quantity: number;
  date_start: string | false;
  date_end: string | false;
}

/** Fecha de Odoo (`YYYY-MM-DD HH:MM:SS`, UTC) a milisegundos. */
function fechaOdoo(f: string): number {
  return Date.parse(`${f.replace(' ', 'T')}Z`);
}

/**
 * La regla que Odoo aplicaría a una unidad de `producto` hoy, o `undefined`.
 *
 * `reglas` son las de la tarifa del cliente para este producto (variante o
 * plantilla). Exportada para probar el orden sin depender de qué reglas tenga
 * hoy la instancia.
 */
export function reglaAplicable(producto: { id: number; templateId: number }, reglas: Regla[], ahora = Date.now()): Regla | undefined {
  return reglas
    .filter((r) =>
      r.applied_on === '0_product_variant'
        ? r.product_id && r.product_id[0] === producto.id
        : r.applied_on === '1_product' && r.product_tmpl_id && r.product_tmpl_id[0] === producto.templateId,
    )
    .filter((r) => r.min_quantity <= 1)
    .filter((r) => !r.date_start || fechaOdoo(r.date_start) <= ahora)
    .filter((r) => !r.date_end || fechaOdoo(r.date_end) >= ahora)
    .sort((a, b) => a.applied_on.localeCompare(b.applied_on) || b.min_quantity - a.min_quantity || b.id - a.id)[0];
}

/** El precio publicable de una regla: solo precio fijo y mayor que cero. */
function precioDe(regla: Regla | undefined): number | null {
  if (!regla || regla.compute_price !== 'fixed') return null;
  return regla.fixed_price > 0 ? regla.fixed_price : null;
}

export interface ResultadoPrecios {
  precios: PublicPrice[];
  desdeCache: boolean;
}

/** Los precios de `skus` en la tarifa del cliente, en el mismo orden. */
export async function preciosDe(tarifa: TarifaCliente, skus: string[], log?: Log): Promise<ResultadoPrecios> {
  const claveDe = (sku: string) => JSON.stringify([tarifa.pricelistId, tarifa.companyId, sku]);

  const resueltos = new Map<string, Omit<PublicPrice, 'sku'>>();
  for (const sku of skus) {
    const enCache = cachePrecios.get(claveDe(sku));
    if (enCache) resueltos.set(sku, enCache);
  }
  const desdeCache = resueltos.size > 0;
  const pendientes = skus.filter((s) => !resueltos.has(s));
  // Para la métrica de #34, solo cuenta la respuesta ENTERA sin Odoo. `desdeCache`
  // sigue diciendo al cliente si algún precio puede tener hasta 5 minutos.
  if (pendientes.length === 0) anotarCacheHit();

  if (pendientes.length > 0) {
    const nuevos = await consultarOdoo(tarifa, pendientes, log);
    for (const [sku, precio] of nuevos) {
      resueltos.set(sku, precio);
      cachePrecios.set(claveDe(sku), precio);
    }
  }

  return { precios: skus.map((sku) => ({ sku, ...resueltos.get(sku)! })), desdeCache };
}

async function consultarOdoo(tarifa: TarifaCliente, skus: string[], log?: Log): Promise<Map<string, Omit<PublicPrice, 'sku'>>> {
  const context = { allowed_company_ids: [tarifa.companyId] };

  const productos = await searchRead<Producto>(
    'product.product',
    [
      ['default_code', 'in', skus],
      ['sale_ok', '=', true],
      // Hoy ningún producto tiene compañía; si alguno la tuviera, otro cliente
      // no debe ni saber que existe. Igual que en `/inventory`.
      ['company_id', 'in', [false, tarifa.companyId]],
    ],
    ['default_code', 'product_tmpl_id'],
    { context },
  );

  const porSku = new Map<string, Producto[]>();
  for (const p of productos) porSku.set(p.default_code, [...(porSku.get(p.default_code) ?? []), p]);
  const unicos = [...porSku.values()].filter((ps) => ps.length === 1).map(([p]) => p);

  const reglas = unicos.length === 0 ? [] : await searchRead<Regla>(
    'product.pricelist.item',
    [
      ['pricelist_id', '=', tarifa.pricelistId],
      '|',
      '&', ['applied_on', '=', '0_product_variant'], ['product_id', 'in', unicos.map((p) => p.id)],
      '&', ['applied_on', '=', '1_product'], ['product_tmpl_id', 'in', unicos.map((p) => p.product_tmpl_id[0])],
    ] satisfies OdooDomain,
    ['applied_on', 'compute_price', 'fixed_price', 'product_id', 'product_tmpl_id', 'min_quantity', 'date_start', 'date_end'],
    { context },
  );

  const resultado = new Map<string, Omit<PublicPrice, 'sku'>>();
  for (const sku of skus) {
    const candidatos = porSku.get(sku) ?? [];
    if (candidatos.length === 0) {
      resultado.set(sku, { productId: null, precio: null, motivo: 'sku_no_encontrado' });
      continue;
    }
    if (candidatos.length > 1) {
      // Dos productos con la misma referencia (hoy, `C84ZVUA`): elegir uno sería
      // cotizar al azar.
      resultado.set(sku, { productId: null, precio: null, motivo: 'sku_ambiguo' });
      continue;
    }

    const [p] = candidatos;
    const regla = reglaAplicable({ id: p.id, templateId: p.product_tmpl_id[0] }, reglas);
    if (regla && regla.compute_price !== 'fixed') {
      log?.warn({ reglaId: regla.id, computePrice: regla.compute_price, pricelistId: tarifa.pricelistId }, 'precios: regla que no se sabe calcular');
    }
    const precio = precioDe(regla);
    resultado.set(sku, { productId: p.id, precio, motivo: precio === null ? 'sin_precio_en_tarifa' : 'ok' });
  }
  return resultado;
}
