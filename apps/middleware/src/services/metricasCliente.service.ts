import type { MetricasCliente } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { dePantalla } from './pantallas.js';
import { perfilDeCompras } from './profile.service.js';
import { programaDeCliente } from './programaAsta.service.js';
import { ultimosDoceMeses } from './rango.js';
import { estadisticasRecomendador } from './recomendador/estadisticas.service.js';
import { periodoDeEtiqueta, resumenAstaDeCliente } from './ventasAsta.service.js';

/**
 * «Mis métricas» de un cliente (fase 1 del sell-out): sus compras de ASTA, su
 * nivel en el programa y lo que se busca en sus tablets. Todo con datos que ya
 * existen; el cliente no tiene que subir nada.
 *
 * El `partnerId` es SIEMPRE el del token (ámbito `identidad`): esta función no
 * se llama con uno que venga de la petición.
 *
 * Cada bloque se lee por su lado y, si falla, sale `null`: que Odoo tarde en
 * las compras no tiene por qué dejar sin el nivel o sin las tablets. Usa las
 * mismas cachés que la ficha del cliente del vendedor (`cliente:<id>:…`); el
 * programa, la del trimestre de todos (`programa:<trimestre>`).
 */

/** Cuántas impresoras y búsquedas sin resultado se enseñan de sus tablets. */
const TOP_TABLETS = 5;

async function susTablets(partnerId: number, rango: { desde: string; hasta: string }): Promise<MetricasCliente['tablets']> {
  const tablets = await prisma.kioskDevice.findMany({ where: { odooPartnerId: partnerId }, select: { id: true } });
  if (tablets.length === 0) return null;
  const e = await estadisticasRecomendador(
    rango,
    tablets.map((t) => t.id),
  );
  return {
    cuantas: tablets.length,
    busquedas: e.totales.busquedas,
    sinResultado: e.totales.sinResultado,
    impresoras: e.impresoras.slice(0, TOP_TABLETS).map((i) => ({ marca: i.marca, nombre: i.nombre, veces: i.veces })),
    sinEncontrar: e.sinResultado.slice(0, TOP_TABLETS).map((s) => ({ texto: s.ejemplo, veces: s.veces })),
  };
}

/**
 * Los doce meses del periodo, en «AAAA-MM» y con cero los que no tienen
 * compra. La serie de `resumenAstaDeCliente` trae solo los meses con compra y
 * con la etiqueta en texto («mayo 2026»), que es el contrato de la ficha del
 * vendedor y no se toca.
 */
function doceMeses(desde: string, serie: Array<{ periodo: string; monto: number; facturas: number }>) {
  const porPeriodo = new Map(serie.map((p) => [periodoDeEtiqueta(p.periodo) ?? p.periodo, p]));
  const [y, m] = desde.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const periodo = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const p = porPeriodo.get(periodo);
    return { periodo, monto: p?.monto ?? 0, facturas: p?.facturas ?? 0 };
  });
}

/** `null` si falla: el bloque sale vacío y los demás, igual. */
async function oNulo<T>(leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch {
    return null;
  }
}

export async function metricasDeCliente(partnerId: number, hoy = new Date()): Promise<MetricasCliente> {
  const periodo = ultimosDoceMeses(hoy);
  const consulta = { desde: periodo.desde, hasta: periodo.hasta, incluirSerieMensual: true };
  const [compras, perfil, programa, tablets] = await Promise.all([
    oNulo(() => dePantalla(`cliente:${partnerId}:facturacion:${JSON.stringify(consulta)}`, () => resumenAstaDeCliente(partnerId, consulta))),
    oNulo(() => perfilDeCompras(partnerId)),
    oNulo(() => programaDeCliente(partnerId, hoy)),
    oNulo(() => susTablets(partnerId, periodo)),
  ]);
  // `resumenAstaDeCliente` declara `currency: string`, pero siempre es 'company'.
  return {
    periodo,
    compras: compras && { ...compras, currency: 'company', serieMensual: doceMeses(periodo.desde, compras.serieMensual ?? []) },
    perfil,
    programa,
    tablets,
  };
}
