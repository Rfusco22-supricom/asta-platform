import {
  DIAS_SIN_RESPUESTA,
  MAX_COTIZACIONES,
  limpiarEspacios,
  nombrePersona,
  type Cotizacion,
  type Cotizaciones,
  estadoCotizacionSchema,
  type EstadoCotizacion,
} from '@asta/shared-types';
import { executeKw, readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { MARCA_ASTA } from './asta.service.js';
import { SIN_INTERCOMPANIA_LINEA_PEDIDO, SIN_INTERCOMPANIA_PEDIDO } from './intercompania.js';
import type { RangoPedido } from './rango.js';
import { enSede } from './sede.js';

/**
 * Las cotizaciones de ASTA (contrato en `@asta/shared-types`, `cotizaciones.ts`):
 * los pedidos de venta con alguna línea ASTA, creados en el periodo, sin
 * Panamá ni intercompañía.
 *
 * ── De quién son ─────────────────────────────────────────────────────────────
 *
 * Las del vendedor son las de los clientes de su cartera (el vendedor de la
 * ficha comercial), como en el resto del panel, y no las que hizo él: así no
 * puede ver las de clientes ajenos, aunque las cotice. En la lista sale quien la
 * hizo en Odoo; de 622 cotizaciones de ago–oct 2026, solo 20 las hizo otro.
 *
 * ── Qué se lee ───────────────────────────────────────────────────────────────
 *
 * Cuatro lecturas en paralelo —cuántas hay en cada estado, lo de ASTA en cada
 * estado, las de más de `DIAS_SIN_RESPUESTA` días abiertas y la lista— y dos
 * más para la lista: lo de ASTA de cada pedido y su ficha comercial. Las
 * cifras cuentan todas; la lista se corta en `MAX_COTIZACIONES`.
 */

const ESTADOS_ODOO: Record<EstadoCotizacion, string[]> = {
  abierta: ['draft', 'sent'],
  confirmada: ['sale', 'done'],
  cancelada: ['cancel'],
};

export function estadoDe(estadoOdoo: string): EstadoCotizacion {
  if (ESTADOS_ODOO.confirmada.includes(estadoOdoo)) return 'confirmada';
  if (ESTADOS_ODOO.cancelada.includes(estadoOdoo)) return 'cancelada';
  return 'abierta';
}

/** Un `estado` que no existe es un 400, no «abiertas»: la pestaña diría una cosa y la lista otra. */
export class EstadoInvalido extends Error {
  readonly status = 400;
  readonly code = 'INVALID_QUERY' as const;
  constructor(valor: unknown) {
    super(`Estado desconocido: ${String(valor)}. Los estados son ${estadoCotizacionSchema.options.join(', ')}.`);
    this.name = 'EstadoInvalido';
  }
}

/** El estado que pide la pantalla; sin él, las abiertas. */
export function estadoDeLaPeticion(query: Record<string, unknown>): EstadoCotizacion {
  if (query.estado === undefined || query.estado === '') return 'abierta';
  const r = estadoCotizacionSchema.safeParse(query.estado);
  if (!r.success) throw new EstadoInvalido(query.estado);
  return r.data;
}

const CARACAS_MS = 4 * 3_600_000;
const DIA_MS = 86_400_000;

/** «2026-10-28 17:27:58» (UTC, como lo da Odoo) → el instante. */
function instante(utc: string): Date {
  return new Date(`${utc.replace(' ', 'T')}Z`);
}

/** El día de Caracas en que cae un instante UTC de Odoo. */
export function diaEnCaracas(utc: string): string {
  return new Date(instante(utc).getTime() - CARACAS_MS).toISOString().slice(0, 10);
}

/** El instante UTC en que empieza un día de Caracas, como lo escribe Odoo. */
function inicioEnUtc(dia: string): string {
  return `${dia} 04:00:00`;
}

function diaSiguiente(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const redondear = (x: number) => Math.round(x * 100) / 100;

export interface ConsultaCotizaciones {
  rango: RangoPedido;
  estado: EstadoCotizacion;
  /** La cartera de un vendedor, o `null` para toda la empresa. */
  odooUserId: number | null;
  sede?: number | null;
}

interface FilaPedido {
  id: number;
  name: string;
  state: string;
  create_date: string;
  validity_date: string | false;
  partner_id: [number, string] | false;
  user_id: [number, string] | false;
  amount_untaxed: number;
}

export async function cotizaciones(c: ConsultaCotizaciones, ahora = new Date()): Promise<Cotizaciones> {
  type Clausula = [string, string, unknown];
  const cartera: Clausula[] =
    c.odooUserId === null
      ? []
      : [
          ['partner_id.commercial_partner_id.user_id', '=', c.odooUserId],
          ['partner_id.commercial_partner_id.active', '=', true],
        ];
  const creadas: Clausula[] = [
    ['create_date', '>=', inicioEnUtc(c.rango.desde)],
    ['create_date', '<', inicioEnUtc(diaSiguiente(c.rango.hasta))],
  ];
  const pedidos: OdooDomain = [
    ['order_line.product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA],
    ...enSede(c.sede ?? null),
    SIN_INTERCOMPANIA_PEDIDO,
    ...creadas,
    ...cartera,
  ];
  // Las mismas condiciones, dichas desde la línea.
  const lineas: OdooDomain = [
    ['product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA],
    ...enSede(c.sede ?? null),
    SIN_INTERCOMPANIA_LINEA_PEDIDO,
    ...[...creadas, ...cartera].map(([campo, op, valor]): Clausula => [`order_id.${campo}`, op, valor]),
  ];
  const haceDias = new Date(ahora.getTime() - DIAS_SIN_RESPUESTA * DIA_MS).toISOString().slice(0, 19).replace('T', ' ');
  const abiertas = c.estado === 'abierta';

  const [conteo, importes, sinRespuesta, lista] = await Promise.all([
    readGroup<{ state: string; __count: number }>('sale.order', pedidos, ['amount_untaxed:sum'], ['state']),
    readGroup<{ state: string; price_subtotal: number }>('sale.order.line', lineas, ['price_subtotal:sum'], ['state']),
    executeKw<number>('sale.order', 'search_count', [[...pedidos, ['state', 'in', ESTADOS_ODOO.abierta], ['create_date', '<', haceDias]]]),
    searchRead<FilaPedido>(
      'sale.order',
      [...pedidos, ['state', 'in', ESTADOS_ODOO[c.estado]]],
      ['name', 'state', 'create_date', 'validity_date', 'partner_id', 'user_id', 'amount_untaxed'],
      { limit: MAX_COTIZACIONES, order: abiertas ? 'create_date asc, id asc' : 'create_date desc, id desc' },
    ),
  ]);

  const totales: Cotizaciones['totales'] = {
    abierta: { cotizaciones: 0, importeAsta: 0 },
    confirmada: { cotizaciones: 0, importeAsta: 0 },
    cancelada: { cotizaciones: 0, importeAsta: 0 },
    sinRespuesta,
  };
  for (const g of conteo) totales[estadoDe(g.state)].cotizaciones += g.__count;
  for (const g of importes) totales[estadoDe(g.state)].importeAsta += g.price_subtotal;
  for (const e of ['abierta', 'confirmada', 'cancelada'] as const) totales[e].importeAsta = redondear(totales[e].importeAsta);

  const ids = lista.map((p) => p.id);
  const contactos = [...new Set(lista.flatMap((p) => (p.partner_id ? [p.partner_id[0]] : [])))];
  const [astaPorPedido, fichas] = ids.length
    ? await Promise.all([
        readGroup<{ order_id: [number, string] | false; price_subtotal: number }>(
          'sale.order.line',
          [['product_id.product_tmpl_id.spiff_brand_id', '=', MARCA_ASTA], ['order_id', 'in', ids]],
          ['price_subtotal:sum'],
          ['order_id'],
        ),
        searchRead<{ id: number; commercial_partner_id: [number, string] | false }>('res.partner', [['id', 'in', contactos]], ['commercial_partner_id'], {
          context: { active_test: false },
        }),
      ])
    : [[], []];
  const asta = new Map(astaPorPedido.flatMap((g) => (g.order_id ? [[g.order_id[0], g.price_subtotal] as [number, number]] : [])));
  const comercial = new Map(fichas.map((f) => [f.id, f.commercial_partner_id || null]));

  const filas: Cotizacion[] = lista.flatMap((p) => {
    if (!p.partner_id) return [];
    const ficha = comercial.get(p.partner_id[0]) ?? null;
    return [
      {
        id: p.id,
        folio: p.name,
        fecha: diaEnCaracas(p.create_date),
        dias: Math.max(0, Math.floor((ahora.getTime() - instante(p.create_date).getTime()) / DIA_MS)),
        vence: p.validity_date || null,
        estado: estadoDe(p.state),
        partnerId: ficha ? ficha[0] : p.partner_id[0],
        cliente: limpiarEspacios(ficha ? ficha[1] : p.partner_id[1]),
        vendedor: p.user_id ? nombrePersona(p.user_id[1]) : null,
        importeAsta: redondear(asta.get(p.id) ?? 0),
        importeTotal: redondear(p.amount_untaxed),
      },
    ];
  });

  return { totales, estado: c.estado, filas };
}
