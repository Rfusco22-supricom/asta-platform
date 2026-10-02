import type { ActividadCartera, ActividadCliente, ClaseCliente, EstadoCliente } from '@asta/shared-types';
import { readGroup, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { FACTURA, TIPO_FACTURADO } from './criterioFacturacion.js';
import { idsDeCartera } from './partners.service.js';
import { UMBRAL_ATENCION_DIAS, UMBRAL_INACTIVO_DIAS, clasificarRecencia } from './profile.service.js';
import { mesDelGrupo, mesesDe } from './reportes.service.js';

/**
 * Cómo está la cartera de un vendedor, cliente a cliente (ver el contrato en
 * `@asta/shared-types`, `cartera.ts`).
 *
 * ── Qué se lee de Odoo ───────────────────────────────────────────────────────
 *
 * Dos `read_group` sobre `account.move`, en paralelo, para TODA la cartera:
 *
 *   · la primera y la última factura de cada cliente, de todo su historial;
 *   · lo facturado mes a mes en los últimos doce, neto de devoluciones.
 *
 * Agrupados por `commercial_partner_id`, como el resto de la cartera: una
 * sucursal cuenta como su matriz.
 *
 * ── Lo que cuesta, y la caché ────────────────────────────────────────────────
 *
 * Medido el 2-oct-2026 contra producción: 4,7 s para la cartera más grande (796
 * clientes) y 1,8 s para una de 397. Por eso se guarda DIEZ MINUTOS por
 * vendedor. Lo que cambia en ese tiempo —una factura nueva— no mueve a nadie de
 * estado ni de clase, y volver a la cartera desde una ficha no repite la espera.
 *
 * La clave es el `odooUserId` del token: dos vendedores nunca comparten
 * entrada, y no hay parámetro con el que pedir la de otro.
 */

/** Un cliente es «nuevo» si su primera factura es de hace menos de esto. */
export const DIAS_CLIENTE_NUEVO = 90;

/** Cortes de la clasificación ABC sobre lo facturado en doce meses. */
export const CORTE_A = 0.8;
export const CORTE_B = 0.95;

const MS_DIA = 86_400_000;

const cache = new CacheTtl<Omit<ActividadCartera, 'meta'> & { meta: Omit<ActividadCartera['meta'], 'desdeCache'> }>(
  10 * 60_000,
  500,
);

/** Para los tests. */
export function vaciarCacheActividad(): void {
  cache.vaciar();
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Días entre dos fechas "AAAA-MM-DD", sin que la hora ni el huso cuenten. */
function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_DIA);
}

const ESTADO_POR_RECENCIA: Record<ReturnType<typeof clasificarRecencia>, EstadoCliente> = {
  activo: 'activo',
  atencion: 'en_riesgo',
  inactivo: 'dormido',
  sin_compras: 'prospecto',
};

export interface EntradaClasificar {
  ids: number[];
  /** Primera y última factura de cada cliente que tiene alguna. */
  fechas: Map<number, { primera: string; ultima: string }>;
  /** Facturado de cada cliente en cada mes "AAAA-MM". */
  porMes: Map<number, Map<string, number>>;
  /** Los doce meses, del más antiguo al actual. */
  meses: string[];
  /** Hoy, "AAAA-MM-DD". */
  hoy: string;
}

/**
 * La clasificación, sin Odoo de por medio: se prueba con datos hechos a mano.
 *
 * El estado usa los umbrales de la ficha del cliente (`profile.service.ts`):
 * la cartera y la ficha no pueden decir cosas distintas del mismo cliente.
 */
export function clasificarCartera({ ids, fechas, porMes, meses, hoy }: EntradaClasificar): ActividadCliente[] {
  const filas = ids.map((partnerId) => {
    const f = fechas.get(partnerId) ?? null;
    const mes = porMes.get(partnerId);
    const serie = meses.map((m) => redondear(mes?.get(m) ?? 0));
    const facturado12m = redondear(serie.reduce((a, b) => a + b, 0));

    const diasSinComprar = f ? Math.max(0, diasEntre(f.ultima, hoy)) : null;
    let estado = ESTADO_POR_RECENCIA[clasificarRecencia(diasSinComprar)];
    if (f && estado === 'activo' && diasEntre(f.primera, hoy) < DIAS_CLIENTE_NUEVO) estado = 'nuevo';

    // El último elemento es el mes en curso, que va a medias: no se compara.
    const completos = serie.slice(0, -1);
    const ultimos3 = completos.slice(-3).reduce((a, b) => a + b, 0);
    const anteriores3 = completos.slice(-6, -3).reduce((a, b) => a + b, 0);
    const tendencia = anteriores3 > 0 ? Math.round(((ultimos3 - anteriores3) / anteriores3) * 100) : null;

    return {
      partnerId,
      ultimaCompra: f?.ultima ?? null,
      primeraCompra: f?.primera ?? null,
      diasSinComprar,
      estado,
      clase: null as ClaseCliente | null,
      facturado12m,
      serie,
      tendencia,
    };
  });

  // ── ABC: el que cruza el 80 % todavía es A ────────────────────────────────
  const conVentas = filas.filter((f) => f.facturado12m > 0).sort((a, b) => b.facturado12m - a.facturado12m);
  const total = conVentas.reduce((a, f) => a + f.facturado12m, 0);
  let acumulado = 0;
  for (const f of conVentas) {
    const antes = acumulado / total;
    f.clase = antes < CORTE_A ? 'A' : antes < CORTE_B ? 'B' : 'C';
    acumulado += f.facturado12m;
  }

  return filas;
}

/** El primer día de hace once meses: con el mes en curso, doce. */
function inicioDeDoceMeses(hoy: string): string {
  const [y, m] = hoy.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - 11, 1));
  return d.toISOString().slice(0, 10);
}

export async function actividadDeCartera(odooUserId: number, ahora = new Date()): Promise<ActividadCartera> {
  const clave = String(odooUserId);
  const enCache = cache.get(clave);
  if (enCache) return { ...enCache, meta: { ...enCache.meta, desdeCache: true } };

  const hoy = ahora.toISOString().slice(0, 10);
  const desde = inicioDeDoceMeses(hoy);
  const meses = mesesDe({ desde, hasta: hoy });

  const ids = await idsDeCartera(odooUserId);

  let fechas = new Map<number, { primera: string; ultima: string }>();
  const porMes = new Map<number, Map<string, number>>();

  // Odoo trata `in []` como «ninguno», pero ni se le pregunta.
  if (ids.length > 0) {
    const base: OdooDomain = [
      ['commercial_partner_id', 'in', ids],
      ['state', '=', 'posted'],
    ];

    const [gruposFechas, gruposMes] = await Promise.all([
      // Solo facturas: una nota de crédito no es una compra.
      readGroup<{ commercial_partner_id: [number, string] | false; primera: string | false; ultima: string | false }>(
        'account.move',
        [...base, ['move_type', '=', FACTURA]],
        ['primera:min(invoice_date)', 'ultima:max(invoice_date)'],
        ['commercial_partner_id'],
      ),
      // Facturas y notas de crédito: `amount_total_signed` ya trae el signo,
      // así que la suma del mes es neta de devoluciones (#26).
      readGroup<{ commercial_partner_id: [number, string] | false; amount_total_signed: number; __domain?: unknown }>(
        'account.move',
        [...base, TIPO_FACTURADO, ['invoice_date', '>=', desde], ['invoice_date', '<=', hoy]],
        ['amount_total_signed:sum'],
        ['commercial_partner_id', 'invoice_date:month'],
      ),
    ]);

    fechas = new Map(
      gruposFechas
        .filter((g) => g.commercial_partner_id && g.primera && g.ultima)
        .map((g) => [(g.commercial_partner_id as [number, string])[0], { primera: g.primera as string, ultima: g.ultima as string }]),
    );

    for (const g of gruposMes) {
      const mes = mesDelGrupo(g);
      if (!g.commercial_partner_id || !mes) continue;
      const id = g.commercial_partner_id[0];
      const delCliente = porMes.get(id) ?? new Map<string, number>();
      delCliente.set(mes, (delCliente.get(mes) ?? 0) + g.amount_total_signed);
      porMes.set(id, delCliente);
    }
  }

  const resultado = {
    data: clasificarCartera({ ids, fechas, porMes, meses, hoy }),
    meta: {
      meses,
      umbrales: { enRiesgo: UMBRAL_ATENCION_DIAS, dormido: UMBRAL_INACTIVO_DIAS, nuevo: DIAS_CLIENTE_NUEVO },
      generadoEn: ahora.toISOString(),
    },
  };
  cache.set(clave, resultado);
  return { ...resultado, meta: { ...resultado.meta, desdeCache: false } };
}
