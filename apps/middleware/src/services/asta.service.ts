import { searchRead, readGroup } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';

/**
 * Cuota de la marca ASTA frente a la competencia, cliente a cliente.
 *
 * ── Qué pregunta contesta ────────────────────────────────────────────────────
 *
 * ASTA es la marca propia de consumibles. En las categorías donde compite
 * —CONSUMIBLES y GENERAL— el reparto medido sobre facturas contabilizadas es:
 *
 *     ASTA          385 clientes       263.306
 *     competencia  1065 clientes     1.948.119     -> ASTA tiene el 11,9 %
 *
 * Y lo que de verdad se puede accionar: **860 clientes compran consumibles y no
 * han comprado ASTA ni una vez**, con 1.805.265 yéndose a HP, Canon, Epson y
 * Brother. Esa es la lista, y va ordenada por lo que cada uno se lleva fuera.
 *
 * ── Por qué por listas de producto y no agrupando por marca ──────────────────
 *
 * Lo natural sería un `read_group` de `account.move.line` por
 * `product_id.product_tmpl_id.spiff_brand_id`. Odoo no lo permite: agrupar por
 * un campo a dos saltos revienta el ORM con un traceback.
 *
 * Así que se resuelve en dos pasos: se piden los ids de producto de las
 * categorías donde ASTA compite, se parten en los de ASTA y los del resto, y se
 * agrupan las líneas de factura con `product_id in [...]`. Dos consultas por
 * lado en vez de una, y funciona.
 *
 * ── Lo que NO se mide ────────────────────────────────────────────────────────
 *
 * Categorías donde ASTA no vende nada. Comparar la cuota de ASTA en ROUTERING
 * sería dividir por una oportunidad que no existe: el cliente no está eligiendo
 * otra marca, es que ASTA no fabrica eso.
 */

/** La marca propia en `product.template.spiff_brand_id`. */
const MARCA_ASTA = 951;

export interface OportunidadAsta {
  partnerId: number;
  nombre: string;
  /** El comercial asignado en Odoo, si lo tiene. */
  vendedorOdooUserId: number | null;
  vendedorNombre: string | null;

  /** Gasto en consumibles de marca ASTA. */
  asta: number;
  /** Gasto en consumibles de las demás marcas. */
  competencia: number;
  /** Porcentaje del gasto en consumibles que va a ASTA. */
  cuota: number;
}

export interface ResumenAsta {
  oportunidades: OportunidadAsta[];
  totales: {
    /** Clientes que compran consumibles de cualquier marca. */
    clientes: number;
    asta: number;
    competencia: number;
    cuota: number;
    /** Clientes que compran consumibles y NUNCA han comprado ASTA. */
    sinAsta: number;
    /** Lo que esos clientes se llevan a la competencia. */
    sinAstaImporte: number;
  };
  generadoEn: string;
  duracionMs: number;
}

/**
 * Los ids de producto, cacheados 30 minutos.
 *
 * El catálogo no cambia de un minuto a otro y resolverlo cuesta dos consultas
 * sobre 1.149 productos. Sin cache, cada carga de la pantalla las repite.
 */
const cacheProductos = new CacheTtl<{ asta: number[]; otros: number[] }>(30 * 60_000, 4);

/** Solo para tests. */
export function vaciarCacheAsta(): void {
  cacheProductos.vaciar();
}

export async function productosEnCompetencia(): Promise<{ asta: number[]; otros: number[] }> {
  const enCache = cacheProductos.get('todos');
  if (enCache !== undefined) return enCache;

  // Las categorías donde ASTA tiene producto. Fuera de ellas no hay nada que
  // comparar: el cliente no elige otra marca, es que ASTA no fabrica eso.
  const cats = await readGroup<{ categ_id: [number, string] | false }>(
    'product.template',
    [['spiff_brand_id', '=', MARCA_ASTA]],
    [],
    ['categ_id'],
  );
  const idsCat = cats.filter((c) => c.categ_id).map((c) => (c.categ_id as [number, string])[0]);

  if (idsCat.length === 0) return { asta: [], otros: [] };

  const [variantes, plantillas] = await Promise.all([
    searchRead<{ id: number; product_tmpl_id: [number, string] }>(
      'product.product',
      [['categ_id', 'in', idsCat]],
      ['id', 'product_tmpl_id'],
    ),
    searchRead<{ id: number; spiff_brand_id: [number, string] | false }>(
      'product.template',
      [['categ_id', 'in', idsCat]],
      ['id', 'spiff_brand_id'],
    ),
  ]);

  const marcaDe = new Map(
    plantillas.map((t) => [t.id, t.spiff_brand_id ? t.spiff_brand_id[0] : 0]),
  );

  const resultado = { asta: [] as number[], otros: [] as number[] };
  for (const v of variantes) {
    if (marcaDe.get(v.product_tmpl_id[0]) === MARCA_ASTA) resultado.asta.push(v.id);
    else resultado.otros.push(v.id);
  }

  cacheProductos.set('todos', resultado);
  return resultado;
}

/**
 * Lo facturado de una lista de productos, por cliente.
 *
 * Se agrupa por `partner_id` y no por `commercial_partner_id` porque el que
 * importa aquí es a quién se le factura. La consolidación bajo la matriz la hace
 * `estadisticasAgentes`, que responde otra pregunta.
 */
async function gastoPorCliente(
  productos: number[],
  filtroPartner: number[] | null,
): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  if (productos.length === 0) return mapa;

  // 400 por lote. El límite no es el número de ids sino el tiempo de Odoo: con
  // los 2.629 partners de #81 en un solo `in` se pasaba del timeout de 30 s.
  const LOTE = 400;

  for (let i = 0; i < productos.length; i += LOTE) {
    const dominio: Array<[string, string, unknown]> = [
      ['display_type', '=', 'product'],
      ['parent_state', '=', 'posted'],
      ['move_id.move_type', '=', 'out_invoice'],
      ['product_id', 'in', productos.slice(i, i + LOTE)],
    ];
    // Un vendedor solo ve lo suyo: el filtro va en el DOMINIO, no en un recorte
    // posterior. Traerse toda la empresa y filtrar en Node deja los datos de los
    // demás pasando por el proceso, que es donde acaban las fugas.
    if (filtroPartner) dominio.push(['partner_id', 'in', filtroPartner]);

    const grupos = await readGroup<{
      partner_id: [number, string] | false;
      price_subtotal: number;
    }>('account.move.line', dominio, ['price_subtotal:sum'], ['partner_id']);

    for (const g of grupos) {
      if (!g.partner_id) continue;
      mapa.set(g.partner_id[0], (mapa.get(g.partner_id[0]) ?? 0) + (g.price_subtotal ?? 0));
    }
  }

  return mapa;
}

/**
 * Oportunidades de cambio a ASTA.
 *
 * `soloDelVendedor` acota a la cartera de un comercial. Es el mismo dato que ve
 * el administrador, recortado: la pantalla del vendedor no puede enseñarle los
 * clientes de otro.
 */
export async function oportunidadesAsta(
  opciones: { soloDelVendedor?: number } = {},
): Promise<ResumenAsta> {
  const t0 = Date.now();
  const { asta: idsAsta, otros: idsOtros } = await productosEnCompetencia();

  // ── A quién se puede mirar ────────────────────────────────────────────────
  let filtroPartner: number[] | null = null;
  let vendedorDe = new Map<number, [number, string]>();

  if (opciones.soloDelVendedor !== undefined) {
    const suyos = await searchRead<{ id: number }>(
      'res.partner',
      [
        ['user_id', '=', opciones.soloDelVendedor],
        ['active', '=', true],
      ],
      ['id'],
    );
    filtroPartner = suyos.map((p) => p.id);

    /*
     * Cartera vacía: se corta aquí y se devuelve vacío.
     *
     * Es un ahorro, NO una red de seguridad. Lo comprobé contra la instancia
     * porque la sospecha era la contraria:
     *
     *     search_count sin filtro    -> 2951
     *     search_count con id in []  ->    0
     *
     * Odoo trata `in []` como «ninguno», así que sin este corte el resultado
     * sería igualmente vacío — solo que después de cuatro consultas inútiles.
     * Que quede escrito el número, porque la intuición de que un `in` vacío
     * «no filtra» es común y aquí es falsa.
     */
    if (filtroPartner.length === 0) {
      return {
        oportunidades: [],
        totales: {
          clientes: 0,
          asta: 0,
          competencia: 0,
          cuota: 0,
          sinAsta: 0,
          sinAstaImporte: 0,
        },
        generadoEn: new Date().toISOString(),
        duracionMs: Date.now() - t0,
      };
    }
  }

  const [gastoAsta, gastoOtros] = await Promise.all([
    gastoPorCliente(idsAsta, filtroPartner),
    gastoPorCliente(idsOtros, filtroPartner),
  ]);

  const todos = new Set([...gastoAsta.keys(), ...gastoOtros.keys()]);
  if (todos.size === 0) {
    return {
      oportunidades: [],
      totales: { clientes: 0, asta: 0, competencia: 0, cuota: 0, sinAsta: 0, sinAstaImporte: 0 },
      generadoEn: new Date().toISOString(),
      duracionMs: Date.now() - t0,
    };
  }

  // ── Nombres y comercial asignado ──────────────────────────────────────────
  const ids = [...todos];
  const fichas: Array<{ id: number; name: string; user_id: [number, string] | false }> = [];
  for (let i = 0; i < ids.length; i += 400) {
    fichas.push(
      ...(await searchRead<{ id: number; name: string; user_id: [number, string] | false }>(
        'res.partner',
        [['id', 'in', ids.slice(i, i + 400)]],
        ['id', 'name', 'user_id'],
      )),
    );
  }
  const ficha = new Map(fichas.map((f) => [f.id, f]));
  vendedorDe = new Map(
    fichas.filter((f) => f.user_id).map((f) => [f.id, f.user_id as [number, string]]),
  );

  const oportunidades: OportunidadAsta[] = ids.map((id) => {
    const a = gastoAsta.get(id) ?? 0;
    const c = gastoOtros.get(id) ?? 0;
    const v = vendedorDe.get(id);

    return {
      partnerId: id,
      nombre: ficha.get(id)?.name ?? `partner ${id}`,
      vendedorOdooUserId: v ? v[0] : null,
      vendedorNombre: v ? v[1] : null,
      asta: Math.round(a * 100) / 100,
      competencia: Math.round(c * 100) / 100,
      cuota: a + c > 0 ? Math.round((a / (a + c)) * 1000) / 10 : 0,
    };
  });

  /*
   * Ordenado por lo que se lleva la COMPETENCIA, no por el total del cliente.
   *
   * La pregunta de esta pantalla es dónde hay más que ganar, y eso es el importe
   * que hoy se va a otra marca. Un cliente enorme que ya compra ASTA casi todo
   * no es una oportunidad: es un cliente atendido.
   */
  oportunidades.sort((a, b) => b.competencia - a.competencia);

  const totalAsta = oportunidades.reduce((s, o) => s + o.asta, 0);
  const totalComp = oportunidades.reduce((s, o) => s + o.competencia, 0);
  const sinAsta = oportunidades.filter((o) => o.asta === 0 && o.competencia > 0);

  return {
    oportunidades,
    totales: {
      clientes: oportunidades.length,
      asta: Math.round(totalAsta * 100) / 100,
      competencia: Math.round(totalComp * 100) / 100,
      cuota:
        totalAsta + totalComp > 0
          ? Math.round((totalAsta / (totalAsta + totalComp)) * 1000) / 10
          : 0,
      sinAsta: sinAsta.length,
      sinAstaImporte: Math.round(sinAsta.reduce((s, o) => s + o.competencia, 0) * 100) / 100,
    },
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };
}
