import { searchRead, readGroup } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { TIPO_FACTURADO_LINEA, plegarPorTipo } from './criterioFacturacion.js';

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
 * ── Por qué una consulta por marca y no agrupando por marca ──────────────────
 *
 * Lo natural sería un `read_group` de `account.move.line` por
 * `product_id.product_tmpl_id.spiff_brand_id`. Odoo no lo permite: agrupar por
 * un campo a dos saltos revienta el ORM con un traceback.
 *
 * FILTRAR por ese campo sí funciona. Así que se agrupa por cliente dos veces:
 * una con la marca igual a ASTA y otra con la marca distinta, las dos dentro de
 * las categorías donde ASTA compite. Ver `gastoPorCliente` para saber por qué
 * el filtro va por la ruta y no con una lista de ids de producto.
 *
 * ── Lo que NO se mide ────────────────────────────────────────────────────────
 *
 * Categorías donde ASTA no vende nada. Comparar la cuota de ASTA en ROUTERING
 * sería dividir por una oportunidad que no existe: el cliente no está eligiendo
 * otra marca, es que ASTA no fabrica eso.
 */

/** La marca propia en `product.template.spiff_brand_id`. */
export const MARCA_ASTA = 951;

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
 * Los ids de producto, cacheados 30 minutos. Los usa `reportes`; esta pantalla
 * ya solo necesita las categorías (ver `gastoPorCliente`).
 *
 * El catálogo no cambia de un minuto a otro y resolverlo cuesta dos consultas
 * sobre 1.149 productos. Sin cache, cada carga de la pantalla las repite.
 */
const cacheProductos = new CacheTtl<{ asta: number[]; otros: number[] }>(30 * 60_000, 4);
/** Las categorías, por lo mismo. */
const cacheCategorias = new CacheTtl<number[]>(30 * 60_000, 4);

/** Solo para tests. */
export function vaciarCacheAsta(): void {
  cacheProductos.vaciar();
  cacheCategorias.vaciar();
}

/**
 * Las categorías donde ASTA tiene producto. Fuera de ellas no hay nada que
 * comparar: el cliente no elige otra marca, es que ASTA no fabrica eso.
 */
export async function categoriasEnCompetencia(): Promise<number[]> {
  const enCache = cacheCategorias.get('todas');
  if (enCache !== undefined) return enCache;

  const cats = await readGroup<{ categ_id: [number, string] | false }>(
    'product.template',
    [['spiff_brand_id', '=', MARCA_ASTA]],
    [],
    ['categ_id'],
  );
  const idsCat = cats.filter((c) => c.categ_id).map((c) => (c.categ_id as [number, string])[0]);

  cacheCategorias.set('todas', idsCat);
  return idsCat;
}

export async function productosEnCompetencia(): Promise<{ asta: number[]; otros: number[] }> {
  const enCache = cacheProductos.get('todos');
  if (enCache !== undefined) return enCache;

  const idsCat = await categoriasEnCompetencia();
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
 * Lo facturado en las categorías en competencia, por cliente, de ASTA o del resto.
 *
 * Se agrupa por `partner_id` y no por `commercial_partner_id` porque el que
 * importa aquí es a quién se le factura. La consolidación bajo la matriz la hace
 * `estadisticasAgentes`, que responde otra pregunta.
 *
 * ── Por qué el producto se filtra por ruta y no con `product_id in [...]` ────
 *
 * Antes se pasaban los 1.155 ids de producto en lotes de 400, y el test de
 * aislamiento caía de vez en cuando por el timeout de 30 s. El SQL no era el
 * problema: un `search_count` del mismo lote tardaba 240 ms. El problema era la
 * RESPUESTA. En Odoo 17, `read_group` devuelve en cada grupo un `__domain` que
 * repite el dominio entero, con la lista de ids incluida: 806 grupos por 400 ids
 * son ~2 MB de JSON por lote, el 95 % de ellos `__domain`, y bastante más en el
 * XML-RPC. Un lote tardaba entre 1 y 15 s según la carga, y las dos vistas del
 * test en paralelo, 14-24 s.
 *
 * Con el filtro por ruta el dominio ocupa seis condiciones y no 400 ids. Es una
 * consulta por lado en vez de una para ASTA y tres para el resto, y la vista de
 * toda la empresa recibe ~750 KB de JSON en vez de ~5,7 MB.
 *
 * `product_id.active` hace falta para dar las MISMAS cifras que la lista de ids.
 * Esa lista salía de un `search_read`, que se salta los productos archivados, y
 * el filtro por ruta no (comprobado: dos productos archivados con ventas, uno
 * de ASTA y uno de HAVIT, movían cinco clientes). Que deban contar es otra
 * discusión, y no se decide aquí de rebote.
 *
 * El `!=` de Odoo deja pasar también los productos sin marca, igual que antes.
 */
async function gastoPorCliente(
  lado: 'asta' | 'otros',
  categorias: number[],
  filtroPartner: number[] | null,
): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  if (categorias.length === 0) return mapa;

  const dominio: Array<[string, string, unknown]> = [
    ['display_type', '=', 'product'],
    ['parent_state', '=', 'posted'],
    TIPO_FACTURADO_LINEA,
    ['product_id.categ_id', 'in', categorias],
    ['product_id.active', '=', true],
    ['product_id.product_tmpl_id.spiff_brand_id', lado === 'asta' ? '=' : '!=', MARCA_ASTA],
  ];
  // Un vendedor solo ve lo suyo: el filtro va en el DOMINIO, no en un recorte
  // posterior. Traerse toda la empresa y filtrar en Node deja los datos de los
  // demás pasando por el proceso, que es donde acaban las fugas.
  if (filtroPartner) dominio.push(['partner_id', 'in', filtroPartner]);

  // Con `move_type` en el groupby: `price_subtotal` viene en positivo también en
  // las notas de crédito, y las devoluciones tienen que restar (#26).
  const grupos = await readGroup<{
    partner_id: [number, string] | false;
    move_type: string | false;
    price_subtotal: number;
    __count: number;
  }>('account.move.line', dominio, ['price_subtotal:sum'], ['partner_id', 'move_type']);

  const porCliente = plegarPorTipo(
    grupos,
    (g) => (g.partner_id ? g.partner_id[0] : null),
    ['price_subtotal'],
    { firmar: true },
  );
  for (const [id, { sumas }] of porCliente) {
    mapa.set(id, (mapa.get(id) ?? 0) + sumas.price_subtotal);
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
  const categorias = await categoriasEnCompetencia();

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
    gastoPorCliente('asta', categorias, filtroPartner),
    gastoPorCliente('otros', categorias, filtroPartner),
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
