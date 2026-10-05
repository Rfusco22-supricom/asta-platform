import type { ClienteImpulsa, EstadoImpulsa, ImpulsaRespuesta, MarcarImpulsa, SugerenciaPasale } from '@asta/shared-types';
import { prisma } from '../../config/prisma.js';
import { readGroup, searchRead } from '../../odoo/client.js';
import { CacheTtl } from '../../utils/cacheTtl.js';
import { MARCA_ASTA } from '../asta.service.js';
import { FACTURA, NOTA_DE_CREDITO, TIPO_FACTURADO_LINEA } from '../criterioFacturacion.js';
import { carteraDesdeLinea } from '../ventasAsta.service.js';
import { equivalentesAsta, type ProductoConsumible } from './equivalentesAsta.js';

/**
 * «Pásale a ASTA» (#40, «Impulsa a tus clientes»).
 *
 * Para cada cliente de la cartera, los consumibles de OTRAS marcas que compra y
 * que tienen un equivalente ASTA con existencias en su almacén
 * (`equivalentesAsta`). Es la acción que más mueve: medido el 2-oct-2026, el
 * 47 % del gasto en consumibles de otras marcas de una cartera grande y el 76 %
 * de otra tiene un ASTA equivalente.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 *   · lo comprado del original en los últimos doce meses, neto de
 *     devoluciones, es de MONTO_MINIMO o más, y la última compra es de hace
 *     DIAS_DESDE_ULTIMA_COMPRA o menos: lo que de verdad sigue comprando;
 *   · hay un ASTA equivalente con existencias en el almacén del cliente;
 *   · el cliente no compra ya ese ASTA: entonces no hay nada que pasarle.
 *
 * ── Lo que hizo el vendedor ─────────────────────────────────────────────────
 *
 * Se guarda en `impulsa_acciones` (ver `ImpulsaAccion` en el esquema). Una
 * sugerencia HECHA vuelve a salir si el cliente compra otra vez el original
 * después de marcarla; una POSPUESTA, cuando llega su fecha.
 *
 * ── Alcance y caché ─────────────────────────────────────────────────────────
 *
 * La cartera sale del `odooUserId` del token (`carteraDesdeLinea`), nunca de un
 * parámetro. Las sugerencias se guardan diez minutos por vendedor; las marcas
 * se leen de MySQL en cada petición, así que marcar se ve al momento.
 */

/** La categoría de consumibles de la instancia, como en `importar-impresoras`. */
export const CATEGORIA_CONSUMIBLES = 2614;
export const MONTO_MINIMO = 100;
export const DIAS_DESDE_ULTIMA_COMPRA = 180;
export const DIAS_VENTANA = 365;
/** Cuántos ASTA se enseñan por sugerencia. */
const MAX_ALTERNATIVAS = 2;

const MS_DIA = 86_400_000;
const restarDias = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * MS_DIA).toISOString().slice(0, 10);

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function partirNombre(display: string): { sku: string | null; nombre: string } {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(display.trim());
  return m ? { sku: m[1]!, nombre: m[2] || display.trim() } : { sku: null, nombre: display.trim() };
}

export interface GrupoConsumible {
  product_id: [number, string] | false;
  partner_id: [number, string] | false;
  move_type: string | false;
  balance: number;
  quantity: number;
  ultima: string | false;
  facturas: number;
}

export interface FichaConsumible extends ProductoConsumible {
  spiff_brand_id: [number, string] | false;
}

export interface AstaConStock extends ProductoConsumible {
  free_qty: number;
}

/** Una sugerencia antes de mirar lo que hizo el vendedor. */
export type SugerenciaSinMarca = Omit<SugerenciaPasale, 'marca' | 'visible'>;
export interface ClienteSinMarcas {
  partnerId: number;
  nombre: string;
  sugerencias: SugerenciaSinMarca[];
}

/**
 * La regla, sin Odoo de por medio.
 *
 * @param catalogoDe los ASTA con existencias del almacén de cada cliente.
 */
export function construirSugerencias(
  grupos: GrupoConsumible[],
  fichas: FichaConsumible[],
  catalogoDe: (partnerId: number) => AstaConStock[],
  hoy: string,
): ClienteSinMarcas[] {
  const ficha = new Map(fichas.map((f) => [f.id, f]));
  const esAsta = (productId: number) => {
    const m = ficha.get(productId)?.spiff_brand_id;
    return m ? m[0] === MARCA_ASTA : false;
  };
  const desdeUltima = restarDias(hoy, DIAS_DESDE_ULTIMA_COMPRA);

  type Compra = { nombreCliente: string; display: string; monto: number; cantidad: number; facturas: number; ultima: string | null };
  const compras = new Map<string, Compra>();
  const astaDe = new Map<number, Set<number>>();

  for (const g of grupos) {
    if (!g.product_id || !g.partner_id) continue;
    const [productId, display] = g.product_id;
    const [partnerId, nombreCliente] = g.partner_id;
    if (esAsta(productId)) {
      const s = astaDe.get(partnerId) ?? new Set<number>();
      s.add(productId);
      astaDe.set(partnerId, s);
      continue;
    }
    const clave = `${partnerId}:${productId}`;
    const c = compras.get(clave) ?? { nombreCliente: nombreCliente.trim(), display, monto: 0, cantidad: 0, facturas: 0, ultima: null };
    const signo = g.move_type === NOTA_DE_CREDITO ? -1 : 1;
    c.monto += -g.balance;
    c.cantidad += signo * g.quantity;
    // La última COMPRA y cuántas: una nota de crédito no lo es.
    if (g.move_type === FACTURA) {
      c.facturas += g.facturas;
      if (g.ultima && (!c.ultima || g.ultima > c.ultima)) c.ultima = g.ultima;
    }
    compras.set(clave, c);
  }

  const porCliente = new Map<number, ClienteSinMarcas>();
  for (const [clave, c] of compras) {
    if (c.monto < MONTO_MINIMO || !c.ultima || c.ultima < desdeUltima) continue;
    const [partnerId, productId] = clave.split(':').map(Number) as [number, number];
    const original = ficha.get(productId);
    if (!original) continue;

    const alternativas = equivalentesAsta(original, catalogoDe(partnerId).filter((a) => a.free_qty > 0));
    if (alternativas.length === 0) continue;
    // Si ya compra alguno de esos ASTA, no hay nada que pasarle.
    const yaCompra = astaDe.get(partnerId);
    if (yaCompra && alternativas.some((a) => yaCompra.has(a.id))) continue;

    const { sku, nombre } = partirNombre(c.display);
    const cliente = porCliente.get(partnerId) ?? { partnerId, nombre: c.nombreCliente, sugerencias: [] };
    cliente.sugerencias.push({
      clave: String(productId),
      original: {
        productId,
        sku: sku ?? (original.default_code || null),
        nombre,
        monto: redondear(c.monto),
        cantidad: redondear(c.cantidad),
        facturas: c.facturas,
        ultimaCompra: c.ultima,
      },
      asta: [...alternativas]
        .sort((a, b) => b.free_qty - a.free_qty)
        .slice(0, MAX_ALTERNATIVAS)
        .map((a) => ({ productId: a.id, sku: a.default_code || null, nombre: a.name.trim(), disponible: redondear(a.free_qty) })),
    });
    porCliente.set(partnerId, cliente);
  }

  for (const cl of porCliente.values()) cl.sugerencias.sort((a, b) => b.original.monto - a.original.monto);
  return [...porCliente.values()];
}

export interface Marca {
  odooPartnerId: number;
  clave: string;
  estado: EstadoImpulsa;
  hasta: Date | null;
  firma: string | null;
}

/** Lo que hizo el vendedor, sobre las sugerencias. Sin Odoo ni MySQL: se prueba solo. */
export function aplicarMarcas(clientes: ClienteSinMarcas[], marcas: Marca[], hoy: string): ClienteImpulsa[] {
  const de = new Map(marcas.map((m) => [`${m.odooPartnerId}:${m.clave}`, m]));
  return clientes
    .map((cl) => {
      const sugerencias: SugerenciaPasale[] = cl.sugerencias.map((s) => {
        const m = de.get(`${cl.partnerId}:${s.clave}`);
        const hasta = m?.hasta ? m.hasta.toISOString().slice(0, 10) : null;
        let visible = true;
        // HECHA: vuelve si el cliente compró otra vez el original después.
        if (m?.estado === 'HECHA') visible = !!m.firma && s.original.ultimaCompra > m.firma;
        if (m?.estado === 'POSPUESTA') visible = !hasta || hasta <= hoy;
        return { ...s, marca: m && m.estado !== 'ACTIVA' ? { estado: m.estado, hasta } : null, visible };
      });
      const enJuego = redondear(sugerencias.filter((s) => s.visible).reduce((t, s) => t + s.original.monto, 0));
      return { partnerId: cl.partnerId, nombre: cl.nombre, enJuego, sugerencias };
    })
    .sort((a, b) => b.enJuego - a.enJuego || a.nombre.localeCompare(b.nombre, 'es'));
}

const cache = new CacheTtl<{ clientes: ClienteSinMarcas[]; generadoEn: string; desde: string; hasta: string }>(10 * 60_000, 500);

/** Para los tests. */
export function vaciarCachePasale(): void {
  cache.vaciar();
}

/** Los ASTA vendibles con sus existencias en cada almacén, en una lectura por almacén. */
async function catalogosPorCliente(partnerIds: number[]): Promise<(partnerId: number) => AstaConStock[]> {
  if (partnerIds.length === 0) return () => [];
  // Los de la cartera son matrices (`parent_id = false`): su compañía es la suya.
  const partners = await searchRead<{ id: number; company_id: [number, string] | false }>('res.partner', [['id', 'in', partnerIds]], ['company_id']);
  const companias = [...new Set(partners.map((p) => (p.company_id ? p.company_id[0] : 0)).filter(Boolean))];

  const catalogoDeCompania = new Map<number, AstaConStock[]>();
  await Promise.all(
    companias.map(async (companyId) => {
      const [almacen] = await searchRead<{ id: number }>('stock.warehouse', [['company_id', '=', companyId]], ['id'], {
        limit: 1,
        context: { allowed_company_ids: [companyId] },
      });
      if (!almacen) return;
      const catalogo = await searchRead<AstaConStock>(
        'product.product',
        [
          ['product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA],
          ['sale_ok', '=', true],
        ],
        ['name', 'default_code', 'free_qty'],
        { context: { warehouse: almacen.id, allowed_company_ids: [companyId] } },
      );
      catalogoDeCompania.set(companyId, catalogo);
    }),
  );

  const compania = new Map(partners.map((p) => [p.id, p.company_id ? p.company_id[0] : 0]));
  return (partnerId) => catalogoDeCompania.get(compania.get(partnerId) ?? 0) ?? [];
}

async function calcular(odooUserId: number, hoy: string): Promise<{ clientes: ClienteSinMarcas[]; generadoEn: string; desde: string; hasta: string; desdeCache: boolean }> {
  const clave = `${odooUserId}:${hoy}`;
  const enCache = cache.get(clave);
  if (enCache) return { ...enCache, desdeCache: true };

  const desde = restarDias(hoy, DIAS_VENTANA);
  const grupos = await readGroup<GrupoConsumible>(
    'account.move.line',
    [
      ['display_type', '=', 'product'],
      ['parent_state', '=', 'posted'],
      TIPO_FACTURADO_LINEA,
      ['invoice_date', '>=', desde],
      ['invoice_date', '<=', hoy],
      ['product_id.categ_id', 'child_of', CATEGORIA_CONSUMIBLES],
      ...carteraDesdeLinea(odooUserId),
    ],
    ['balance:sum', 'quantity:sum', 'ultima:max(invoice_date)', 'facturas:count_distinct(move_id)'],
    ['product_id', 'partner_id', 'move_type'],
  );

  const ids = [...new Set(grupos.map((g) => (g.product_id ? g.product_id[0] : 0)).filter(Boolean))];
  const fichas = ids.length
    ? await searchRead<FichaConsumible>('product.product', [['id', 'in', ids]], ['name', 'default_code', 'spiff_brand_id'], { context: { active_test: false } })
    : [];
  const partners = [...new Set(grupos.map((g) => (g.partner_id ? g.partner_id[0] : 0)).filter(Boolean))];
  const catalogoDe = await catalogosPorCliente(partners);

  const resultado = { clientes: construirSugerencias(grupos, fichas, catalogoDe, hoy), generadoEn: new Date().toISOString(), desde, hasta: hoy };
  cache.set(clave, resultado);
  return { ...resultado, desdeCache: false };
}

/** Las sugerencias del vendedor, con lo que ya hizo con ellas. */
export async function sugerenciasPasale(odooUserId: number, appUserId: string, ahora = new Date()): Promise<ImpulsaRespuesta> {
  const hoy = ahora.toISOString().slice(0, 10);
  const [c, marcas] = await Promise.all([
    calcular(odooUserId, hoy),
    prisma.impulsaAccion.findMany({
      where: { userId: appUserId, tipo: 'pasale_a_asta' },
      select: { odooPartnerId: true, clave: true, estado: true, hasta: true, firma: true },
    }),
  ]);
  const data = aplicarMarcas(c.clientes, marcas, hoy);
  const todas = data.flatMap((cl) => cl.sugerencias);
  return {
    data,
    meta: {
      pendientes: {
        clientes: data.filter((cl) => cl.sugerencias.some((x) => x.visible)).length,
        sugerencias: todas.filter((x) => x.visible).length,
        enJuego: redondear(data.reduce((t, cl) => t + cl.enJuego, 0)),
      },
      atendidas: todas.filter((x) => !x.visible).length,
      ventana: { desde: c.desde, hasta: c.hasta },
      reglas: { montoMinimo: MONTO_MINIMO, diasDesdeUltimaCompra: DIAS_DESDE_ULTIMA_COMPRA },
      generadoEn: c.generadoEn,
      desdeCache: c.desdeCache,
    },
  };
}

export class SugerenciaNoEncontrada extends Error {
  readonly status = 404;
  // El genérico: un código propio obligaría a ampliar el contrato de errores por un 404.
  readonly code = 'NOT_FOUND' as const;
  constructor() {
    super('Esa sugerencia ya no está: puede que el cliente haya cambiado de compras. Recarga la página.');
    this.name = 'SugerenciaNoEncontrada';
  }
}

/**
 * Marca una sugerencia. La ownership del cliente ya la comprobó `autorizar`
 * (`impulsa.marcar`, ámbito partner-propio); aquí se comprueba además que la
 * sugerencia exista HOY en su cartera, y la `firma` se toma del servidor, no
 * del navegador.
 */
export async function marcarSugerencia(odooUserId: number, appUserId: string, partnerId: number, cuerpo: MarcarImpulsa, ahora = new Date()): Promise<void> {
  const hoy = ahora.toISOString().slice(0, 10);
  const { clientes } = await calcular(odooUserId, hoy);
  const sugerencia = clientes.find((c) => c.partnerId === partnerId)?.sugerencias.find((s) => s.clave === cuerpo.clave);
  if (!sugerencia) throw new SugerenciaNoEncontrada();

  const datos = {
    estado: cuerpo.estado,
    hasta: cuerpo.estado === 'POSPUESTA' ? new Date(`${restarDias(hoy, -(cuerpo.dias ?? 7))}T00:00:00Z`) : null,
    firma: cuerpo.estado === 'HECHA' ? sugerencia.original.ultimaCompra : null,
  };
  await prisma.impulsaAccion.upsert({
    where: { userId_odooPartnerId_tipo_clave: { userId: appUserId, odooPartnerId: partnerId, tipo: cuerpo.tipo, clave: cuerpo.clave } },
    create: { userId: appUserId, odooPartnerId: partnerId, tipo: cuerpo.tipo, clave: cuerpo.clave, ...datos },
    update: datos,
  });
}
