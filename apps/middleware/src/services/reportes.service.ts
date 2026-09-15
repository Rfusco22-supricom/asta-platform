import { searchRead, readGroup, type OdooDomain } from '../odoo/client.js';
import { productosEnCompetencia } from './asta.service.js';

/**
 * Reportes de facturación por periodo.
 *
 * ── Para qué existe ──────────────────────────────────────────────────────────
 *
 * El panel enseña el histórico completo de cada cliente, uno a uno. Lo que no
 * había forma de contestar era «cómo vamos este trimestre», que es la pregunta
 * que hoy se responde pidiéndole a alguien que saque un reporte de Odoo. El
 * entregable de la fase de vendedores está escrito así en el roadmap: *los
 * vendedores usan el panel a diario y dejan de pedir reportes*.
 *
 * ── Un solo criterio, y escrito donde se lee ─────────────────────────────────
 *
 * `incluirNotasDeCredito` está en `false`, que es la definición literal de
 * «total facturado» de la especificación y la misma que usa
 * `invoicing.service.ts`. La decisión de fondo sigue abierta (#26) y NO se toma
 * aquí: lo que se hace es devolverla en la respuesta, para que la pantalla diga
 * con qué criterio está sumando.
 *
 * Esto importa más de lo que parece. Si el panel y el ERP dan números distintos
 * y nadie sabe por qué, el vendedor deja de mirar el panel — y a partir de ahí
 * da igual lo bien que esté hecho el resto.
 *
 * ── El alcance del vendedor va en el dominio ─────────────────────────────────
 *
 * Un comercial ve su cartera y nada más. El filtro se pone en el dominio de
 * Odoo, nunca recortando en Node lo que ya llegó: traerse la empresa entera y
 * quedarse con un trozo deja los datos de los demás pasando por el proceso, que
 * es por donde acaban saliendo.
 */

export interface RangoFechas {
  /** YYYY-MM-DD, inclusiva. */
  desde: string;
  /** YYYY-MM-DD, inclusiva. */
  hasta: string;
}

export interface Reporte {
  periodo: RangoFechas;
  /** Con qué criterio se sumó. Va en la respuesta para poder decirlo en pantalla. */
  criterio: {
    incluyeNotasDeCredito: boolean;
    /** Solo facturas contabilizadas; los borradores no cuentan. */
    soloContabilizadas: true;
  };

  totales: {
    facturado: number;
    porCobrar: number;
    facturas: number;
    ticketPromedio: number;
    /** Clientes distintos con al menos una factura en el periodo. */
    clientes: number;
  };

  /** Evolución mes a mes. Los meses sin factura salen en cero, no se omiten. */
  serieMensual: Array<{ periodo: string; monto: number; facturas: number }>;

  topClientes: Array<{
    partnerId: number;
    nombre: string;
    facturado: number;
    facturas: number;
  }>;

  /** Solo para administración. `null` en la vista del vendedor. */
  porVendedor: Array<{
    odooUserId: number | null;
    nombre: string;
    facturado: number;
    porCobrar: number;
    facturas: number;
  }> | null;

  /** Cuota de ASTA frente a las demás marcas, en el mismo periodo. */
  asta: {
    asta: number;
    competencia: number;
    /** Porcentaje del gasto en consumibles que se llevó ASTA. */
    cuota: number;
  };

  generadoEn: string;
  duracionMs: number;
}

export interface OpcionesReporte extends RangoFechas {
  /** `res.users.id` del comercial. Sin esto, el reporte es de toda la empresa. */
  soloDelVendedor?: number;
  incluirNotasDeCredito?: boolean;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Los meses del rango, en orden y sin huecos.
 *
 * Odoo no devuelve los meses sin facturas, y una serie que se salta un mes malo
 * dibuja una línea que sube cuando en realidad no se vendió nada. El hueco es
 * justo el dato que hay que ver.
 */
export function mesesDe({ desde, hasta }: RangoFechas): string[] {
  const meses: string[] = [];
  const [ay, am] = desde.split('-').map(Number);
  const [by, bm] = hasta.split('-').map(Number);

  let y = ay;
  let m = am;
  // Cota de seguridad: un rango absurdo no debe colgar el proceso.
  while ((y < by || (y === by && m <= bm)) && meses.length < 120) {
    meses.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return meses;
}

/**
 * De qué mes es un grupo de `invoice_date:month`.
 *
 * Odoo etiqueta el grupo con el nombre del mes EN EL IDIOMA del usuario del
 * ERP: contra la instancia real devuelve «enero 2026», no «2026-01». Traducir
 * esos nombres sería atarse al idioma de una cuenta de servicio que cualquiera
 * puede cambiar desde Ajustes, y la serie se rompería sin que fallara nada.
 *
 * Por eso el mes sale del `__domain` que Odoo adjunta a cada grupo, que viene
 * en ISO.
 *
 * ── Y por eso se coge el MÁXIMO, no el primero ──────────────────────────────
 *
 * Ese dominio trae DOS cláusulas `invoice_date >=`: la del filtro que pidió el
 * reporte y la del mes concreto. Medido contra Odoo, el grupo de febrero llega
 * así:
 *
 *   ["invoice_date",">=","2026-01-01"]   <- el rango que se pidió
 *   ["invoice_date","<=","2026-03-31"]
 *   ["invoice_date",">=","2026-02-01"]   <- el mes de ESTE grupo
 *   ["invoice_date","<","2026-03-01"]
 *
 * Quedarse con la primera hacía que febrero y marzo se etiquetaran como enero y
 * que la serie entera se apilara en el primer mes del rango. La del mes es
 * siempre la más tardía, porque está dentro del rango pedido.
 */
export function mesDelGrupo(grupo: { __domain?: unknown }): string | null {
  const dominio = grupo.__domain;
  if (!Array.isArray(dominio)) return null;

  let mayor: string | null = null;
  for (const clausula of dominio) {
    if (!Array.isArray(clausula) || clausula.length !== 3) continue;
    const [campo, operador, valor] = clausula as [string, string, unknown];
    if (campo !== 'invoice_date' || operador !== '>=') continue;
    if (typeof valor !== 'string') continue;
    if (mayor === null || valor > mayor) mayor = valor;
  }
  return mayor === null ? null : mayor.slice(0, 7);
}

/** Los partners de la cartera de un comercial. */
async function carteraDe(odooUserId: number): Promise<number[]> {
  const filas = await searchRead<{ id: number }>(
    'res.partner',
    [
      ['user_id', '=', odooUserId],
      ['active', '=', true],
    ],
    ['id'],
  );
  return filas.map((f) => f.id);
}

function vacio(opciones: OpcionesReporte, t0: number): Reporte {
  return {
    periodo: { desde: opciones.desde, hasta: opciones.hasta },
    criterio: {
      incluyeNotasDeCredito: opciones.incluirNotasDeCredito ?? false,
      soloContabilizadas: true,
    },
    totales: { facturado: 0, porCobrar: 0, facturas: 0, ticketPromedio: 0, clientes: 0 },
    serieMensual: mesesDe(opciones).map((periodo) => ({ periodo, monto: 0, facturas: 0 })),
    topClientes: [],
    porVendedor: opciones.soloDelVendedor === undefined ? [] : null,
    asta: { asta: 0, competencia: 0, cuota: 0 },
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };
}

/** Lo facturado de una lista de productos en el periodo, como un único total. */
async function totalDeProductos(
  productos: number[],
  rango: RangoFechas,
  cartera: number[] | null,
): Promise<number> {
  if (productos.length === 0) return 0;

  // 400 por lote, como en `asta.service`: el límite no es el número de ids sino
  // el tiempo de Odoo. Con 2.629 en un solo `in` se pasaba del timeout de 30 s.
  const LOTE = 400;
  let total = 0;

  for (let i = 0; i < productos.length; i += LOTE) {
    const dominio: OdooDomain = [
      ['display_type', '=', 'product'],
      ['parent_state', '=', 'posted'],
      ['move_id.move_type', '=', 'out_invoice'],
      ['move_id.invoice_date', '>=', rango.desde],
      ['move_id.invoice_date', '<=', rango.hasta],
      ['product_id', 'in', productos.slice(i, i + LOTE)],
    ];
    if (cartera) dominio.push(['partner_id', 'in', cartera]);

    // Sin `groupby`: se pide el agregado del lote entero, que es lo único que
    // necesita el reporte. Agrupar por cliente aquí costaría lo mismo y se
    // tiraría después.
    const grupos = await readGroup<{ price_subtotal: number }>(
      'account.move.line',
      dominio,
      ['price_subtotal:sum'],
      [],
    );
    for (const g of grupos) total += g.price_subtotal ?? 0;
  }

  return total;
}

/**
 * El reporte del periodo.
 *
 * Cuesta 4 RPC más los lotes de producto de la parte de ASTA, y NO depende del
 * número de facturas: todo se agrega en Odoo y aquí solo llegan los grupos.
 */
export async function reporte(opciones: OpcionesReporte): Promise<Reporte> {
  const t0 = Date.now();
  const deLaEmpresa = opciones.soloDelVendedor === undefined;
  const incluirNotas = opciones.incluirNotasDeCredito ?? false;

  let cartera: number[] | null = null;
  if (!deLaEmpresa) {
    cartera = await carteraDe(opciones.soloDelVendedor as number);
    /*
     * Cartera vacía: se corta aquí.
     *
     * No es una red de seguridad, es un ahorro: Odoo trata `in []` como
     * «ninguno» —medido, `search_count` con `id in []` da 0 frente a 2951 sin
     * filtro—, así que el resultado sería igualmente vacío, solo que después de
     * varias consultas inútiles.
     */
    if (cartera.length === 0) return vacio(opciones, t0);
  }

  const tipos = incluirNotas ? ['out_invoice', 'out_refund'] : ['out_invoice'];
  const base: OdooDomain = [
    ['move_type', 'in', tipos],
    ['state', '=', 'posted'],
    ['invoice_date', '>=', opciones.desde],
    ['invoice_date', '<=', opciones.hasta],
  ];
  if (cartera) base.push(['commercial_partner_id', 'in', cartera]);

  const campos = ['amount_total_signed:sum', 'amount_residual_signed:sum'];

  const [porMes, porCliente, porVendedor, idsProducto] = await Promise.all([
    readGroup<{
      amount_total_signed: number;
      amount_residual_signed: number;
      __count: number;
      __domain?: unknown;
    }>('account.move', base, campos, ['invoice_date:month']),
    readGroup<{
      commercial_partner_id: [number, string] | false;
      amount_total_signed: number;
      __count: number;
    }>('account.move', base, campos, ['commercial_partner_id']),
    deLaEmpresa
      ? readGroup<{
          invoice_user_id: [number, string] | false;
          amount_total_signed: number;
          amount_residual_signed: number;
          __count: number;
        }>('account.move', base, campos, ['invoice_user_id'])
      : Promise.resolve([]),
    productosEnCompetencia(),
  ]);

  // ── Serie mensual, rellenando los meses sin factura ───────────────────────
  const conDatos = new Map<string, { monto: number; facturas: number }>();
  for (const g of porMes) {
    const mes = mesDelGrupo(g);
    if (!mes) continue;
    conDatos.set(mes, { monto: g.amount_total_signed ?? 0, facturas: g.__count });
  }
  const serieMensual = mesesDe(opciones).map((periodo) => ({
    periodo,
    monto: redondear(conDatos.get(periodo)?.monto ?? 0),
    facturas: conDatos.get(periodo)?.facturas ?? 0,
  }));

  // ── Totales y top de clientes ─────────────────────────────────────────────
  let facturado = 0;
  let porCobrar = 0;
  let facturas = 0;

  const clientes = porCliente
    .filter((g) => g.commercial_partner_id)
    .map((g) => {
      const id = (g.commercial_partner_id as [number, string])[0];
      const nombre = (g.commercial_partner_id as [number, string])[1];
      return {
        partnerId: id,
        nombre: nombre.trim(),
        facturado: redondear(g.amount_total_signed ?? 0),
        facturas: g.__count,
      };
    });

  for (const g of porCliente) {
    facturado += g.amount_total_signed ?? 0;
    facturas += g.__count;
  }
  // El saldo sale de la serie mensual y no del corte por cliente: son los mismos
  // documentos agrupados de otra forma, así que el total es el mismo y no cuesta
  // una consulta más.
  for (const g of porMes) porCobrar += g.amount_residual_signed ?? 0;

  const [asta, competencia] = await Promise.all([
    totalDeProductos(idsProducto.asta, opciones, cartera),
    totalDeProductos(idsProducto.otros, opciones, cartera),
  ]);
  const consumibles = asta + competencia;

  return {
    periodo: { desde: opciones.desde, hasta: opciones.hasta },
    criterio: { incluyeNotasDeCredito: incluirNotas, soloContabilizadas: true },
    totales: {
      facturado: redondear(facturado),
      porCobrar: redondear(porCobrar),
      facturas,
      ticketPromedio: facturas > 0 ? redondear(facturado / facturas) : 0,
      clientes: clientes.length,
    },
    serieMensual,
    topClientes: clientes.sort((a, b) => b.facturado - a.facturado).slice(0, 15),
    porVendedor: deLaEmpresa
      ? porVendedor
          .map((g) => ({
            odooUserId: g.invoice_user_id ? g.invoice_user_id[0] : null,
            nombre: g.invoice_user_id ? g.invoice_user_id[1].trim() : 'Sin comercial asignado',
            facturado: redondear(g.amount_total_signed ?? 0),
            porCobrar: redondear(g.amount_residual_signed ?? 0),
            facturas: g.__count,
          }))
          .sort((a, b) => b.facturado - a.facturado)
      : null,
    asta: {
      asta: redondear(asta),
      competencia: redondear(competencia),
      cuota: consumibles > 0 ? Math.round((asta / consumibles) * 1000) / 10 : 0,
    },
    generadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
  };
}
