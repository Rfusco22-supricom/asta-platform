import { MIN_CLIENTES_ZONA, PARTE_ALTA_ZONA, type ComparativaZona, type GrupoZona, type MedidaZona } from '@asta/shared-types';
import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { ultimosDoceMeses, type RangoPedido } from './rango.js';
import { mesDelGrupo } from './reportes.service.js';
import { enSede } from './sede.js';
import { deSede, enRango, smartbit } from './smartbit.service.js';
import { LINEAS_ASTA } from './ventasAsta.service.js';

/**
 * «Tú frente a tu zona» (reglas en `@asta/shared-types`, `comparativaZona.ts`):
 * cómo compra ASTA un cliente al lado de los de su estado y del país.
 *
 * Dos lecturas a Odoo para todos los clientes —lo de ASTA por cliente y
 * producto, y por cliente y mes, netas de devoluciones— más la historia de
 * Smartbit, y el estado de cada uno. Se guarda seis horas: compararse con la
 * zona no necesita la factura de hace un minuto.
 */

/** Lo de un cliente que compró ASTA en el periodo. */
export interface CompraCliente {
  /** Neto, sin IVA, redondeado al céntimo. */
  compras: number;
  referencias: number;
  meses: number;
  /** La clave de su estado (`zonaDe`), o null si su ficha no lo tiene. */
  zona: string | null;
}

export interface TablaZonas {
  clientes: Map<number, CompraCliente>;
  /** Clave de zona → el nombre que se enseña. */
  nombres: Map<string, string>;
}

/**
 * El estado de una ficha de Odoo como zona: «Carabobo (VE)» → `carabobo`.
 *
 * Sin el país ni los acentos en la clave: hay fichas con el Bolívar de Ecuador
 * o el Sucre de Colombia elegidos por error, y son clientes de aquí. El nombre
 * que se enseña prefiere el de Venezuela (ver `leerTabla`).
 */
export function zonaDe(estado: string | null | false | undefined): { clave: string; nombre: string; deVenezuela: boolean } | null {
  if (!estado) return null;
  const m = /^(.*?)\s*\(([A-Z]{2})\)$/.exec(estado.trim());
  const nombre = (m ? m[1]! : estado).trim();
  if (!nombre) return null;
  const clave = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return { clave, nombre, deVenezuela: !m || m[2] === 'VE' };
}

const cache = new CacheTtl<TablaZonas>(6 * 3600_000, 2);

function sumar<K>(m: Map<number, Map<K, number>>, id: number, k: K, monto: number): void {
  const delCliente = m.get(id) ?? new Map<K, number>();
  delCliente.set(k, (delCliente.get(k) ?? 0) + monto);
  m.set(id, delCliente);
}

async function leerTabla(periodo: RangoPedido): Promise<TablaZonas> {
  const base: OdooDomain = [...LINEAS_ASTA, ['invoice_date', '>=', periodo.desde], ['invoice_date', '<=', periodo.hasta], ...enSede(null)];
  const [porProducto, porMes, sb] = await Promise.all([
    readGroup<{ partner_id: [number, string] | false; product_id: [number, string] | false; balance: number }>('account.move.line', base, ['balance:sum'], ['partner_id', 'product_id']),
    readGroup<{ partner_id: [number, string] | false; balance: number; __domain?: unknown }>('account.move.line', base, ['balance:sum'], ['partner_id', 'invoice_date:month']),
    smartbit(),
  ]);

  // `-balance`: la venta es un haber, y la nota de crédito resta sola.
  const productos = new Map<number, Map<string, number>>();
  const meses = new Map<number, Map<string, number>>();
  for (const g of porProducto) if (g.partner_id && g.product_id) sumar(productos, g.partner_id[0], String(g.product_id[0]), -g.balance);
  for (const g of porMes) {
    const mes = mesDelGrupo(g);
    if (g.partner_id && mes) sumar(meses, g.partner_id[0], mes, -g.balance);
  }
  for (const v of sb.ventas) {
    if (v.partnerId === null || !enRango(v, periodo) || !deSede(v, null)) continue;
    sumar(productos, v.partnerId, v.productId !== null ? String(v.productId) : `sb:${v.sku ?? v.articulo}`, v.venta);
    sumar(meses, v.partnerId, v.fecha.slice(0, 7), v.venta);
  }

  const clientes = new Map<number, CompraCliente>();
  for (const [id, porProd] of productos) {
    const compras = Math.round([...porProd.values()].reduce((s, x) => s + x, 0) * 100) / 100;
    if (compras <= 0) continue;
    const positivos = (m: Map<string, number> | undefined) => [...(m?.values() ?? [])].filter((x) => x > 0).length;
    clientes.set(id, { compras, referencias: positivos(porProd), meses: positivos(meses.get(id)), zona: null });
  }

  const nombres = new Map<string, string>();
  if (clientes.size) {
    const fichas = await searchRead<{ id: number; state_id: [number, string] | false }>('res.partner', [['id', 'in', [...clientes.keys()]]], ['state_id'], {
      context: { active_test: false },
    });
    for (const f of fichas) {
      const z = zonaDe(f.state_id ? f.state_id[1] : null);
      if (!z) continue;
      clientes.get(f.id)!.zona = z.clave;
      if (!nombres.has(z.clave) || z.deVenezuela) nombres.set(z.clave, z.nombre);
    }
  }
  return { clientes, nombres };
}

/** El cuantil `q` de una lista ordenada de menor a mayor, interpolando entre vecinos. */
export function cuantil(ordenados: number[], q: number): number {
  if (ordenados.length === 0) return 0;
  const pos = (ordenados.length - 1) * q;
  const abajo = Math.floor(pos);
  const arriba = Math.ceil(pos);
  return ordenados[abajo]! + (ordenados[arriba]! - ordenados[abajo]!) * (pos - abajo);
}

function medida(valores: number[], tuyo: number): MedidaZona {
  const o = [...valores].sort((a, b) => a - b);
  // Redondeado: el grupo se dice en cifras redondas, no con la de un cliente al céntimo.
  return { tuyo, tipico: Math.round(cuantil(o, 0.5)), parteAlta: Math.round(cuantil(o, 1 - PARTE_ALTA_ZONA)) };
}

export function grupo(ambito: GrupoZona['ambito'], nombre: string, miembros: CompraCliente[], suyo: CompraCliente | undefined): GrupoZona {
  return {
    ambito,
    nombre,
    clientes: miembros.length,
    puesto: suyo ? 1 + miembros.filter((c) => c.compras > suyo.compras).length : null,
    compras: medida(
      miembros.map((c) => c.compras),
      suyo?.compras ?? 0,
    ),
    referencias: medida(
      miembros.map((c) => c.referencias),
      suyo?.referencias ?? 0,
    ),
    meses: medida(
      miembros.map((c) => c.meses),
      suyo?.meses ?? 0,
    ),
  };
}

/**
 * La comparativa, con los datos ya leídos. Pura: es lo que prueban los tests.
 *
 * @param estado el estado de SU ficha: cuenta aunque no haya comprado.
 */
export function compararCon(tabla: TablaZonas, partnerId: number, estado: string | null): Omit<ComparativaZona, 'periodo'> {
  const suyo = tabla.clientes.get(partnerId);
  const todos = [...tabla.clientes.values()];
  const z = zonaDe(estado);
  const deSuZona = z ? todos.filter((c) => c.zona === z.clave) : [];
  return {
    estado: z ? (tabla.nombres.get(z.clave) ?? z.nombre) : null,
    zona: z && deSuZona.length >= MIN_CLIENTES_ZONA ? grupo('ZONA', tabla.nombres.get(z.clave) ?? z.nombre, deSuZona, suyo) : null,
    pais: todos.length ? grupo('PAIS', 'todo el país', todos, suyo) : null,
  };
}

export async function comparativaZona(partnerId: number, hoy = new Date()): Promise<ComparativaZona> {
  const periodo = ultimosDoceMeses(hoy);
  const clave = `${periodo.desde}:${periodo.hasta}`;
  const [tabla, ficha] = await Promise.all([
    cache.get(clave) ??
      leerTabla(periodo).then((t) => {
        cache.set(clave, t);
        return t;
      }),
    searchRead<{ state_id: [number, string] | false }>('res.partner', [['id', '=', partnerId]], ['state_id'], { context: { active_test: false } }),
  ]);
  const estado = ficha[0]?.state_id ? ficha[0].state_id[1] : null;
  return { periodo, ...compararCon(tabla, partnerId, estado) };
}
