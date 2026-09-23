import type { InformeDuplicados } from '@asta/shared-types';
import { readGroup, searchRead } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { agrupar, gruposParaCubrir, resumir, type Registro } from './duplicados.js';

/**
 * El informe de fusiones pendientes, leído de Odoo (#50).
 *
 * ── Por qué existe como servicio y no solo como script ───────────────────────
 *
 * La detección está en `duplicados.ts` —lógica pura, sin red— y el análisis
 * existía únicamente en `scripts/analizar-duplicados.ts`. Eso dejaba el informe
 * al alcance de quien tiene las credenciales de Odoo y una terminal, que no es
 * quien hace las fusiones ni quien tiene que decidir si se hacen.
 *
 * Fusionar no lo hace el panel: se hace en Odoo, no se deshace y mueve comisión
 * de una cartera a otra. Lo que el panel puede hacer es que la lista esté
 * delante de quien decide, siempre al día, y que ENCOJA a medida que se fusiona
 * —porque se recalcula de Odoo, no de una foto. Esa es la diferencia entre un CSV
 * de hace tres semanas y una tarea con final visible.
 *
 * ── Qué sale y qué se queda en el recuento ───────────────────────────────────
 *
 * Solo los grupos con la facturación REPARTIDA. Los otros dos tipos —sin
 * facturas, o con todo en un registro— son el 79 % de los grupos y no distorsionan
 * ninguna cifra del panel; mandarlos sería devolverle al lector el problema de
 * separar el ruido, que es justo lo que este informe hace por él.
 */

/** El informe entero, una hora. */
const cache = new CacheTtl<InformeDuplicados & { generadoEn: string; duracionMs: number }>(60 * 60_000, 2);

/** Los porcentajes del dinero repartido para los que se dice cuántas fusiones hacen falta. */
const OBJETIVOS = [50, 80, 90, 95] as const;

/** Solo para tests. */
export function vaciarCacheDuplicados(): void {
  cache.vaciar();
}

interface FilaPartner {
  id: number;
  name: string;
  vat: string | false;
  user_id: [number, string] | false;
}

/**
 * Los clientes de primer nivel activos, con su facturación.
 *
 * Solo PRIMER NIVEL: las sucursales (`parent_id != false`) no son duplicados,
 * son parte legítima de la estructura de un cliente, y el panel ya las consolida
 * bajo la matriz con `child_of`. Incluirlas llenaría el informe de falsos
 * positivos y quien lo lea dejaría de creerlo a la tercera fila.
 *
 * La facturación va en UNA consulta agrupada y no una por cliente: son casi 9.000
 * y a un RPC cada uno esto no terminaría.
 */
export async function registrosDeOdoo(): Promise<Registro[]> {
  const [partners, grupos] = await Promise.all([
    searchRead<FilaPartner>(
      'res.partner',
      [
        ['customer_rank', '>', 0],
        ['parent_id', '=', false],
        ['active', '=', true],
      ],
      ['id', 'name', 'vat', 'user_id'],
    ),
    readGroup<{
      commercial_partner_id: [number, string] | false;
      amount_total_signed: number;
      __count: number;
    }>(
      'account.move',
      [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
      ],
      ['amount_total_signed:sum'],
      ['commercial_partner_id'],
    ),
  ]);

  const facturacion = new Map<number, { monto: number; facturas: number }>();
  for (const g of grupos) {
    if (!g.commercial_partner_id) continue;
    facturacion.set(g.commercial_partner_id[0], {
      monto: g.amount_total_signed ?? 0,
      facturas: g.__count,
    });
  }

  return partners.map((p) => {
    const f = facturacion.get(p.id);
    return {
      id: p.id,
      nombre: p.name,
      rif: p.vat || null,
      vendedorId: p.user_id ? p.user_id[0] : null,
      vendedor: p.user_id ? p.user_id[1] : null,
      facturas: f?.facturas ?? 0,
      monto: f?.monto ?? 0,
    };
  });
}

const redondear = (n: number) => Math.round(n * 100) / 100;

export async function informeDeDuplicados(): Promise<
  InformeDuplicados & { generadoEn: string; duracionMs: number; desdeCache: boolean }
> {
  const enCache = cache.get('todos');
  if (enCache) return { ...enCache, desdeCache: true };

  const t0 = Date.now();
  const registros = await registrosDeOdoo();
  const todos = agrupar(registros);
  const r = resumir(todos, registros);

  const informe: InformeDuplicados & { generadoEn: string; duracionMs: number } = {
    grupos: todos
      .filter((g) => g.clase === 'partido')
      .map((g) => ({
        clave: g.clave,
        motivo: g.motivo,
        montoTotal: redondear(g.montoTotal),
        montoFuera: redondear(g.montoFuera),
        conFacturas: g.conFacturas,
        vendedores: g.vendedores,
        registros: g.registros.map((reg) => ({
          partnerId: reg.id,
          nombre: reg.nombre.trim(),
          rif: reg.rif,
          facturado: redondear(reg.monto),
          facturas: reg.facturas,
          vendedorNombre: reg.vendedor,
          esDestino: reg.id === g.principal,
        })),
      })),
    resumen: {
      registros: r.registros,
      grupos: r.grupos,
      sinFacturas: r.sinFacturas,
      inocuos: r.inocuos,
      partidos: r.partidos,
      montoPartido: redondear(r.montoPartido),
      montoTotalFacturado: redondear(r.montoTotalFacturado),
      partidosEntreVendedores: r.partidosEntreVendedores,
    },
    /*
     * Se calcula sobre TODOS los grupos, no sobre los que van en la respuesta.
     *
     * `gruposParaCubrir` ya filtra los partidos por dentro. Pasarle la lista ya
     * filtrada daría el mismo número hoy y sería una dependencia silenciosa de
     * ese detalle.
     */
    fusionesPara: OBJETIVOS.map((porcentaje) => ({
      porcentaje,
      fusiones: gruposParaCubrir(todos, porcentaje),
    })),
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };

  cache.set('todos', informe);
  return { ...informe, desdeCache: false };
}
