import {
  MESES_SEMAFORO,
  colorDe,
  diasDesde,
  limpiarEspacios,
  nombrePersona,
  tamanoDe,
  type ClienteSemaforo,
  type ImpresoraSemaforo,
  type SedeId,
  type Semaforo,
  type TamanoTienda,
} from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { readGroup, searchRead } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { TIPO_FACTURADO, TIPO_FACTURADO_LINEA, plegarPorTipo } from './criterioFacturacion.js';
import { SIN_INTERCOMPANIA, SIN_INTERCOMPANIA_LINEA } from './intercompania.js';
import { enSede } from './sede.js';
import { LINEA_ASTA, carteraDesdeLinea } from './ventasAsta.service.js';
import { plantillasAsta } from './recomendador/demanda.service.js';
import { extraerImpresoraDeCatalogo } from './recomendador/extraerImpresoraDeCatalogo.js';
import { esLaMisma } from './recomendador/importarImpresorasDeCatalogo.js';

/**
 * El semáforo de clientes (reglas en `@asta/shared-types`, `semaforo.ts`): las
 * impresoras que cada cliente nos compró y si les compra el tóner ASTA.
 *
 * ── De dónde sale cada cosa ──────────────────────────────────────────────────
 *
 *   · Las impresoras, de las líneas de factura de la categoría IMPRESORA de
 *     Odoo (la misma de `importar-impresoras-catalogo`), por cliente y producto.
 *   · Qué impresora es cada producto, con el mismo reconocimiento que cargó el
 *     catálogo en `printer_models` (`extraerImpresoraDeCatalogo` + `esLaMisma`).
 *   · Sus tóners ASTA, de las compatibilidades VALIDADAS del panel, como la
 *     aplicación ASTA (`plantillasAsta`).
 *   · Lo que compra de ASTA y su compra total (para el tamaño), de Odoo.
 *
 * Todo de solo lectura. El vendedor ve su cartera (`carteraDesdeLinea`, por el
 * `odooUserId` del token); el administrador, la empresa o una sede.
 */

/** La categoría IMPRESORA de Odoo, como en `cli/importar-impresoras-catalogo.ts`. */
export const CATEGORIA_IMPRESORAS = 2610;

const cacheModelos = new CacheTtl<Modelos>(3600_000, 1);
const cacheTamanos = new CacheTtl<Map<number, TamanoTienda>>(6 * 3600_000, 2);

interface Modelos {
  porMarca: Map<string, Array<{ id: number; nombre: string; nameNormalized: string }>>;
  /** printerModelId → plantillas ASTA validadas. */
  astaDe: Map<number, number[]>;
}

function desdeDe(hoy: Date): string {
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - MESES_SEMAFORO + 1, 1)).toISOString().slice(0, 10);
}

/** Las impresoras de la base y sus tóners ASTA validados. Cambian poco: una hora. */
async function modelos(): Promise<Modelos> {
  const enCache = cacheModelos.get('m');
  if (enCache) return enCache;
  const [filas, relaciones, productos, asta] = await Promise.all([
    prisma.printerModel.findMany({ where: { isActive: true }, select: { id: true, name: true, nameNormalized: true, brand: { select: { name: true } } } }),
    prisma.cartridgePrinterModel.findMany({ where: { status: 'VALIDADA' }, select: { printerModelId: true, cartridgeId: true } }),
    prisma.productCartridge.findMany({ where: { status: 'VALIDADA' }, select: { cartridgeId: true, odooProductTmplId: true } }),
    plantillasAsta(),
  ]);
  const porMarca = new Map<string, Array<{ id: number; nombre: string; nameNormalized: string }>>();
  for (const f of filas) {
    const k = f.brand.name.toLowerCase();
    porMarca.set(k, [...(porMarca.get(k) ?? []), { id: f.id, nombre: `${f.brand.name} ${f.name}`, nameNormalized: f.nameNormalized }]);
  }
  const tmplDe = new Map<number, number[]>();
  for (const p of productos) if (asta.has(p.odooProductTmplId)) tmplDe.set(p.cartridgeId, [...(tmplDe.get(p.cartridgeId) ?? []), p.odooProductTmplId]);
  const astaDe = new Map<number, number[]>();
  for (const r of relaciones) {
    const t = tmplDe.get(r.cartridgeId);
    if (t) astaDe.set(r.printerModelId, [...new Set([...(astaDe.get(r.printerModelId) ?? []), ...t])]);
  }
  const m = { porMarca, astaDe };
  cacheModelos.set('m', m);
  return m;
}

/**
 * Qué es un producto de la categoría IMPRESORA: `undefined` si no es una
 * impresora (bandejas, placas de red… también están en la categoría), `null` si
 * es una impresora que no está en la base, o su modelo.
 */
export function modeloDelProducto(nombre: string, referencia: string | null, m: Modelos['porMarca']): { id: number; nombre: string } | null | undefined {
  const r = extraerImpresoraDeCatalogo(nombre, referencia);
  if (!r.ok) return r.motivo === 'no_es_impresora' ? undefined : null;
  const candidatos = (m.get(r.impresora.marca.toLowerCase()) ?? []).filter((c) => esLaMisma(c.nameNormalized, r.impresora));
  if (candidatos.length === 0) return null;
  // El nombre exacto antes que uno que solo acaba igual.
  const exacto = candidatos.find((c) => c.nameNormalized === r.impresora.nombreNormalizado);
  return exacto ?? candidatos[0]!;
}

/**
 * El tamaño de cada cliente de la empresa por su compra total (todas las
 * marcas) en el periodo, como percentil entre todos los que compraron. De toda
 * la empresa siempre, para que «grande» signifique lo mismo en cada cartera.
 */
async function tamanos(desde: string): Promise<Map<number, TamanoTienda>> {
  const enCache = cacheTamanos.get(desde);
  if (enCache) return enCache;
  const grupos = await readGroup<{ commercial_partner_id: [number, string] | false; move_type: string; amount_untaxed_signed: number; __count: number }>(
    'account.move',
    [TIPO_FACTURADO, ['state', '=', 'posted'], SIN_INTERCOMPANIA, ['invoice_date', '>=', desde]] as never,
    ['amount_untaxed_signed:sum'],
    ['commercial_partner_id', 'move_type'],
  );
  const total = new Map<number, number>();
  for (const g of grupos) if (g.commercial_partner_id) total.set(g.commercial_partner_id[0], (total.get(g.commercial_partner_id[0]) ?? 0) + g.amount_untaxed_signed);
  const orden = [...total.entries()].filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1]);
  const r = new Map<number, TamanoTienda>();
  orden.forEach(([id], i) => r.set(id, tamanoDe(orden.length > 1 ? i / (orden.length - 1) : 1)));
  cacheTamanos.set(desde, r);
  return r;
}

type Grupo = { partner_id: [number, string] | false; product_id: [number, string] | false; move_type: string; quantity: number; invoice_date?: string | false; __count: number };

/** Unidades netas por cliente y producto, solo las positivas. */
function unidades(grupos: Grupo[]): Map<number, Map<number, number>> {
  const plegado = plegarPorTipo(grupos, (g) => (g.partner_id && g.product_id ? `${g.partner_id[0]}:${g.product_id[0]}` : null), ['quantity'], { firmar: true });
  const r = new Map<number, Map<number, number>>();
  for (const [clave, p] of plegado) {
    if ((p.sumas.quantity ?? 0) <= 0) continue;
    const [cliente, producto] = clave.split(':').map(Number) as [number, number];
    const m = r.get(cliente) ?? new Map<number, number>();
    m.set(producto, p.sumas.quantity!);
    r.set(cliente, m);
  }
  return r;
}

export async function semaforoClientes(opciones: { odooUserId: number | null; sede?: SedeId | null; hoy?: Date }): Promise<Semaforo> {
  const hoy = opciones.hoy ?? new Date();
  const desde = desdeDe(hoy);
  const hasta = hoy.toISOString().slice(0, 10);
  const alcance = [...(opciones.odooUserId === null ? [] : carteraDesdeLinea(opciones.odooUserId)), ...enSede(opciones.sede ?? null)];
  const base = [['parent_state', '=', 'posted'], TIPO_FACTURADO_LINEA, ['display_type', '=', 'product'], SIN_INTERCOMPANIA_LINEA, ['invoice_date', '>=', desde], ...alcance];

  const [gruposImpresoras, gruposAsta, m, tamanoDeCliente] = await Promise.all([
    readGroup<Grupo>('account.move.line', [...base, ['product_id.categ_id', 'child_of', CATEGORIA_IMPRESORAS]] as never, ['quantity:sum'], ['partner_id', 'product_id', 'move_type']),
    // Con la fecha de la última factura de cada grupo: de ahí, cuánto lleva sin comprar ASTA.
    readGroup<Grupo>('account.move.line', [...base, LINEA_ASTA] as never, ['quantity:sum', 'invoice_date:max'], ['partner_id', 'product_id', 'move_type']),
    modelos(),
    tamanos(desde),
  ]);
  const impresorasDe = unidades(gruposImpresoras);
  const astaDe = unidades(gruposAsta);
  // La última compra de ASTA: la factura más reciente, no una nota de crédito.
  const ultimaAsta = new Map<number, string>();
  for (const g of gruposAsta) {
    if (!g.partner_id || g.move_type !== 'out_invoice' || !g.invoice_date) continue;
    const id = g.partner_id[0];
    if (!ultimaAsta.has(id) || g.invoice_date > ultimaAsta.get(id)!) ultimaAsta.set(id, g.invoice_date);
  }
  const nombreCliente = new Map<number, string>();
  for (const g of gruposImpresoras) if (g.partner_id) nombreCliente.set(g.partner_id[0], g.partner_id[1]);

  // Los productos: las impresoras, para reconocerlas; los ASTA, para su plantilla.
  const idsImpresora = [...new Set([...impresorasDe.values()].flatMap((p) => [...p.keys()]))];
  const idsAsta = [...new Set([...astaDe.values()].flatMap((p) => [...p.keys()]))];
  const [productosImpresora, productosAsta] = await Promise.all([
    idsImpresora.length
      ? searchRead<{ id: number; name: string; default_code: string | false }>('product.product', [['id', 'in', idsImpresora]], ['name', 'default_code'], { context: { active_test: false } })
      : [],
    idsAsta.length
      ? searchRead<{ id: number; product_tmpl_id: [number, string] }>('product.product', [['id', 'in', idsAsta]], ['product_tmpl_id'], { context: { active_test: false } })
      : [],
  ]);
  const impresoraDe = new Map(productosImpresora.map((p) => [p.id, { modelo: modeloDelProducto(p.name, p.default_code || null, m.porMarca), nombre: limpiarEspacios(p.name) }]));
  const tmplDe = new Map(productosAsta.map((p) => [p.id, p.product_tmpl_id[0]]));

  // Las plantillas ASTA que salen en algún semáforo, para su referencia y nombre.
  const tmplsUsadas = new Set<number>();
  for (const [, productos] of impresorasDe) for (const pid of productos.keys()) for (const t of m.astaDe.get(impresoraDe.get(pid)?.modelo?.id ?? -1) ?? []) tmplsUsadas.add(t);
  const plantillas = tmplsUsadas.size
    ? await searchRead<{ id: number; name: string; default_code: string | false }>('product.template', [['id', 'in', [...tmplsUsadas]]], ['name', 'default_code'], { context: { active_test: false } })
    : [];
  const plantilla = new Map(plantillas.map((p) => [p.id, { sku: p.default_code || null, nombre: limpiarEspacios(p.name) }]));

  // El comercial de cada cliente, solo en la vista de administración.
  const vendedorDe = new Map<number, string | null>();
  if (opciones.odooUserId === null && impresorasDe.size) {
    const partners = await searchRead<{ id: number; user_id: [number, string] | false }>('res.partner', [['id', 'in', [...impresorasDe.keys()]]], ['user_id'], {
      context: { active_test: false },
    });
    for (const p of partners) vendedorDe.set(p.id, p.user_id ? nombrePersona(p.user_id[1]) : null);
  }

  const clientes: ClienteSemaforo[] = [];
  for (const [partnerId, productos] of impresorasDe) {
    const compradas = new Set([...(astaDe.get(partnerId)?.keys() ?? [])].flatMap((pid) => (tmplDe.has(pid) ? [tmplDe.get(pid)!] : [])));
    // Un modelo con varios productos (colores, versiones) es una sola fila.
    const porModelo = new Map<string, ImpresoraSemaforo>();
    for (const [pid, n] of productos) {
      const p = impresoraDe.get(pid);
      if (!p || p.modelo === undefined) continue;
      const clave = p.modelo ? `m${p.modelo.id}` : `p${pid}`;
      const antes = porModelo.get(clave);
      if (antes) {
        antes.unidades += n;
        continue;
      }
      const toners = (p.modelo ? (m.astaDe.get(p.modelo.id) ?? []) : []).map((t) => ({
        odooProductTmplId: t,
        sku: plantilla.get(t)?.sku ?? null,
        nombre: plantilla.get(t)?.nombre ?? `Producto ${t}`,
        comprado: compradas.has(t),
      }));
      porModelo.set(clave, {
        printerModelId: p.modelo?.id ?? null,
        nombre: p.modelo?.nombre ?? p.nombre,
        unidades: n,
        toners,
        cubierta: toners.some((t) => t.comprado),
      });
    }
    const detalle = [...porModelo.values()].sort((a, b) => b.unidades - a.unidades);
    const conAsta = detalle.filter((i) => i.toners.length > 0).length;
    const cubiertas = detalle.filter((i) => i.cubierta).length;
    const ultimaCompraAsta = ultimaAsta.get(partnerId) ?? null;
    const diasSinAsta = diasDesde(ultimaCompraAsta, hasta);
    const color = colorDe(conAsta, cubiertas, diasSinAsta);
    if (!color) continue;
    clientes.push({
      partnerId,
      nombre: limpiarEspacios(nombreCliente.get(partnerId) ?? `Cliente ${partnerId}`),
      vendedor: opciones.odooUserId === null ? (vendedorDe.get(partnerId) ?? null) : null,
      tamano: tamanoDeCliente.get(partnerId) ?? 'PEQUENA',
      color,
      impresoras: detalle.reduce((s, i) => s + i.unidades, 0),
      conAsta,
      cubiertas,
      ultimaCompraAsta,
      diasSinAsta,
      enfriado: color !== colorDe(conAsta, cubiertas),
      detalle,
    });
  }

  const ordenColor = { ROJO: 0, AMARILLO: 1, VERDE: 2 } as const;
  const ordenTamano = { GRANDE: 0, MEDIANA: 1, PEQUENA: 2 } as const;
  clientes.sort((a, b) => ordenColor[a.color] - ordenColor[b.color] || ordenTamano[a.tamano] - ordenTamano[b.tamano] || b.impresoras - a.impresoras);

  return {
    desde,
    hasta,
    totales: {
      ROJO: clientes.filter((c) => c.color === 'ROJO').length,
      AMARILLO: clientes.filter((c) => c.color === 'AMARILLO').length,
      VERDE: clientes.filter((c) => c.color === 'VERDE').length,
      impresoras: clientes.reduce((s, c) => s + c.impresoras, 0),
    },
    clientes,
  };
}
