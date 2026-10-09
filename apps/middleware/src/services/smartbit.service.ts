import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { CacheConRefresco } from '../utils/cacheConRefresco.js';
import { logger } from '../utils/logger.js';
import { MARCA_ASTA } from './asta.service.js';

/**
 * Las ventas ASTA de Smartbit, el sistema de antes de Odoo.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * En Odoo, ASTA empieza el 1-abr-2026; Smartbit llega hasta el 31-mar-2026. Sin
 * esto, los «últimos doce meses» del panel tenían seis, y un cliente que compró
 * ASTA en marzo salía como prospecto. Las dos fuentes no se pisan: de Smartbit
 * se lee solo lo anterior a `CORTE_SMARTBIT`, así que nada se cuenta dos veces.
 *
 * ── Qué es cada fila ─────────────────────────────────────────────────────────
 *
 * Una línea de venta (`ventas_smartbit`, ver el modelo `VentaSmartbit`):
 * `venta` sin IVA, las devoluciones en negativo. Sin número de factura ni saldo,
 * así que:
 *
 *   · una «compra» es un cliente en un día con un vendedor (`compras`): es lo
 *     que hace de factura al contar facturas, ticket promedio o clientes;
 *   · Smartbit no suma nada a «por cobrar».
 *
 * ── Cómo se casa con Odoo (decisión del 5-oct-2026) ──────────────────────────
 *
 *   · El VENDEDOR es el de la fila, por nombre, contra los usuarios de Odoo
 *     (`normalizarNombre`). Lo que no casa —«Local», ex-empleados sin usuario—
 *     se cuenta en la empresa, sin vendedor.
 *   · El CLIENTE, por RIF (`normalizarRif`) contra el `vat` de los clientes
 *     comerciales de Odoo. La historia de un cliente es suya, se la vendiera
 *     quien se la vendiera: así la ve su ficha y su fila de la cartera.
 *   · El PRODUCTO, por la referencia interna (`default_code`) de los ASTA.
 *
 * ── Lo que cuesta ────────────────────────────────────────────────────────────
 *
 * ~35.000 filas y tres lecturas de Odoo (clientes con RIF, usuarios, productos
 * ASTA), unos dos segundos. Se carga al arrancar el servidor (`server.ts`) y se
 * renueva por detrás cada hora (`CacheConRefresco`): la tabla es historia y ya
 * no cambia, lo que se mueve es Odoo —un cliente nuevo con un RIF de Smartbit—,
 * y nadie espera por eso. Si la tabla no se puede leer —una base sin ella, o
 * sin el GRANT— el panel sigue solo con Odoo y se vuelve a intentar en la
 * siguiente petición.
 */

/** Primer día que cuenta Odoo. De Smartbit se lee lo anterior. */
export const CORTE_SMARTBIT = '2026-04-01';

export interface VentaSmartbit {
  /** "AAAA-MM-DD". */
  fecha: string;
  /** El usuario de Odoo del vendedor, o null si su nombre no casa con ninguno. */
  vendedorId: number | null;
  /** El nombre tal como viene, sin espacios de más. */
  vendedor: string;
  /** El RIF normalizado, o null si la fila no lo trae. */
  rif: string | null;
  /** El cliente comercial de Odoo con ese RIF (ver `elegirCliente`). */
  partnerId: number | null;
  cliente: string;
  /** El producto de Odoo con esa referencia, si lo hay. */
  productId: number | null;
  sku: string | null;
  articulo: string;
  venta: number;
  unidades: number;
}

/** Un cliente en un día con un vendedor: lo que en Smartbit hace de factura. */
export function claveCompra(v: Pick<VentaSmartbit, 'fecha' | 'rif' | 'cliente' | 'vendedor'>): string {
  return `${v.fecha}|${v.rif ?? v.cliente}|${v.vendedor}`;
}

/**
 * Las compras de unas ventas, una fila por cada una (la primera de la compra,
 * que trae fecha, cliente y vendedor). Un día con solo devoluciones no es una
 * compra, igual que en Odoo una nota de crédito no es una factura.
 */
export function compras(ventas: VentaSmartbit[]): VentaSmartbit[] {
  const porClave = new Map<string, { v: VentaSmartbit; neto: number }>();
  for (const v of ventas) {
    const k = claveCompra(v);
    const c = porClave.get(k);
    if (c) c.neto += v.venta;
    else porClave.set(k, { v, neto: v.venta });
  }
  return [...porClave.values()].filter((c) => c.neto > 0).map((c) => c.v);
}

/** Mayúsculas, sin acentos ni signos, un espacio entre palabras. «EMILI BRICEÑO.» = «Emili Briceno». */
export function normalizarNombre(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * El RIF sin guiones, puntos ni espacios: "J-41285173-0" = "J412851730".
 * Smartbit escribe algunos con una C delante ("CJ412851730"); se quita.
 */
export function normalizarRif(s: string | null | undefined): string | null {
  const r = (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r) return null;
  const conC = /^C([VJGEP]\d+)$/.exec(r);
  return conC ? conC[1]! : r;
}

/** Solo los dígitos, para los RIF que en un lado llevan la letra y en el otro no. */
function digitosDe(rif: string): string {
  return rif.replace(/\D/g, '');
}

export interface ClienteConRif {
  id: number;
  vat: string;
  active: boolean;
  user_id: [number, string] | false;
}

/**
 * Qué cliente de Odoo es el de un RIF. Hay RIF repetidos (clientes
 * duplicados): se queda el activo, mejor con vendedor asignado, y entre
 * iguales el más antiguo.
 */
export function elegirCliente(candidatos: ClienteConRif[]): number | null {
  const orden = [...candidatos].sort(
    (a, b) => Number(b.active) - Number(a.active) || Number(Boolean(b.user_id)) - Number(Boolean(a.user_id)) || a.id - b.id,
  );
  return orden[0]?.id ?? null;
}

export interface IndiceRif {
  /** RIF normalizado → clientes de Odoo con ese RIF. */
  porRif: Map<string, ClienteConRif[]>;
  /** Solo dígitos → clientes, para cuando la letra falta en un lado. */
  porDigitos: Map<string, ClienteConRif[]>;
}

function agregar<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const lista = m.get(k);
  if (lista) lista.push(v);
  else m.set(k, [v]);
}

export function indexarPorRif(clientes: ClienteConRif[]): IndiceRif {
  const porRif = new Map<string, ClienteConRif[]>();
  const porDigitos = new Map<string, ClienteConRif[]>();
  for (const c of clientes) {
    const rif = normalizarRif(c.vat);
    if (!rif) continue;
    agregar(porRif, rif, c);
    const d = digitosDe(rif);
    if (d.length >= 6) agregar(porDigitos, d, c);
  }
  return { porRif, porDigitos };
}

/**
 * Los clientes de Odoo con ese RIF. Por dígitos solo si todos los candidatos
 * son el mismo RIF: "V12345678" y "J12345678" son dos personas distintas.
 */
export function clientesDelRif(rif: string | null, indice: IndiceRif): ClienteConRif[] {
  if (!rif) return [];
  const exactos = indice.porRif.get(rif);
  if (exactos) return exactos;
  const porDigitos = indice.porDigitos.get(digitosDe(rif)) ?? [];
  const rifs = new Set(porDigitos.map((c) => normalizarRif(c.vat)));
  return rifs.size === 1 ? porDigitos : [];
}

interface FilaSmartbit {
  fecha: Date;
  vendedor: string | null;
  codigoCliente: string | null;
  cliente: string | null;
  codigoArticulo: string | null;
  articulo: string | null;
  venta: { toNumber(): number } | number;
  unidades: { toNumber(): number } | number;
}

export interface Smartbit {
  ventas: VentaSmartbit[];
  indice: IndiceRif;
}

const cache = new CacheConRefresco<Smartbit>(60 * 60_000, 24 * 60 * 60_000, 1);

/** Para los tests. */
export function vaciarCacheSmartbit(): void {
  cache.vaciar();
}

/** La tabla no se pudo leer: no es un error del panel, es que no hay Smartbit. */
class SinTablaSmartbit extends Error {}

const VACIO: Smartbit = { ventas: [], indice: { porRif: new Map(), porDigitos: new Map() } };

function numero(x: { toNumber(): number } | number): number {
  return typeof x === 'number' ? x : x.toNumber();
}

/** Las ventas ASTA de Smartbit, ya casadas con Odoo. */
export async function smartbit(): Promise<Smartbit> {
  try {
    return await cache.obtener('', leerSmartbit);
  } catch (error) {
    if (!(error instanceof SinTablaSmartbit)) throw error;
    logger.warn({ err: error.cause }, 'No se pudo leer ventas_smartbit: el panel sigue solo con Odoo');
    return VACIO;
  }
}

async function leerSmartbit(): Promise<Smartbit> {
  let filas: FilaSmartbit[];
  try {
    filas = await prisma.ventaSmartbit.findMany({
      where: { marca: 'ASTA', fecha: { lt: new Date(`${CORTE_SMARTBIT}T00:00:00Z`) } },
      select: { fecha: true, vendedor: true, codigoCliente: true, cliente: true, codigoArticulo: true, articulo: true, venta: true, unidades: true },
    });
  } catch (error) {
    throw new SinTablaSmartbit('ventas_smartbit', { cause: error });
  }

  const [clientes, usuarios, productos] = await Promise.all([
    searchRead<ClienteConRif>('res.partner', [['vat', '!=', false], ['parent_id', '=', false]], ['id', 'vat', 'active', 'user_id'], {
      context: { active_test: false },
    }),
    searchRead<{ id: number; name: string }>('res.users', [['share', '=', false]], ['id', 'name'], { context: { active_test: false } }),
    searchRead<{ id: number; default_code: string | false }>('product.product', [['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA]], ['id', 'default_code'], {
      context: { active_test: false },
    }),
  ]);

  const indice = indexarPorRif(clientes);
  const clienteDe = new Map<string, number | null>();

  // Un nombre que llevan dos usuarios no se adivina: queda sin vendedor.
  const usuarioDe = new Map<string, number | null>();
  for (const u of usuarios) {
    const n = normalizarNombre(u.name);
    usuarioDe.set(n, usuarioDe.has(n) ? null : u.id);
  }
  const productoDe = new Map<string, number>();
  for (const p of productos) if (p.default_code) productoDe.set(p.default_code.trim().toUpperCase(), p.id);

  const ventas = filas.map((f): VentaSmartbit => {
    const rif = normalizarRif(f.codigoCliente);
    const clave = rif ?? '';
    if (!clienteDe.has(clave)) clienteDe.set(clave, elegirCliente(clientesDelRif(rif, indice)));
    const sku = f.codigoArticulo?.trim() || null;
    const vendedor = (f.vendedor ?? '').replace(/\s+/g, ' ').trim();
    return {
      fecha: f.fecha.toISOString().slice(0, 10),
      vendedorId: usuarioDe.get(normalizarNombre(vendedor)) ?? null,
      vendedor,
      rif,
      partnerId: clienteDe.get(clave) ?? null,
      cliente: (f.cliente ?? '').trim(),
      productId: sku ? (productoDe.get(sku.toUpperCase()) ?? null) : null,
      sku,
      articulo: (f.articulo ?? '').trim(),
      venta: numero(f.venta),
      unidades: numero(f.unidades),
    };
  });

  return { ventas, indice };
}

export function enRango(v: Pick<VentaSmartbit, 'fecha'>, rango: { desde?: string; hasta?: string }): boolean {
  return (!rango.desde || v.fecha >= rango.desde) && (!rango.hasta || v.fecha <= rango.hasta);
}

/**
 * Las ventas de los clientes de una lista, cada una en UNO de ellos.
 *
 * La historia de un RIF va al cliente de la lista con ese RIF; si la lista
 * tiene dos (duplicados), al primero según `elegirCliente`, para que el total
 * de la lista no la cuente dos veces.
 */
export function ventasDeClientes(sb: Smartbit, ids: Iterable<number>): Map<number, VentaSmartbit[]> {
  const enLista = new Set(ids);
  const destino = new Map<string, number | null>();
  const r = new Map<number, VentaSmartbit[]>();
  for (const v of sb.ventas) {
    if (!v.rif) continue;
    if (!destino.has(v.rif)) destino.set(v.rif, elegirCliente(clientesDelRif(v.rif, sb.indice).filter((c) => enLista.has(c.id))));
    const id = destino.get(v.rif);
    if (id == null) continue;
    agregar(r, id, v);
  }
  return r;
}

/** Las ventas de un cliente de Odoo: las de su RIF. */
export async function ventasSmartbitDeCliente(partnerId: number): Promise<VentaSmartbit[]> {
  return ventasDeClientes(await smartbit(), [partnerId]).get(partnerId) ?? [];
}
