/**
 * Comparar dos copias de la configuración de Odoo (#48).
 *
 * ── Por qué esto hace falta ──────────────────────────────────────────────────
 *
 * Una copia que nadie puede leer no sirve de nada, y hasta ahora la única
 * instrucción para usarla era:
 *
 *   diff <(gzip -dc vieja.json.gz | jq -S .) <(gzip -dc nueva.json.gz | jq -S .)
 *
 * Con dos problemas. El primero, que `jq` no está instalado en la máquina de
 * desarrollo, así que la instrucción no funciona donde se iba a usar.
 *
 * El segundo es peor y no se arregla instalando nada: son **35.008 reglas de
 * precio**. Un `diff` textual de eso escupe miles de líneas por un solo precio
 * cambiado, y lo que se busca —"¿qué se tocó ayer?"— queda enterrado. Un
 * respaldo que solo se puede comparar a ojo es un respaldo que nadie compara.
 *
 * ── Qué compara, y en qué orden ──────────────────────────────────────────────
 *
 * Primero lo que cambia los precios que ve un cliente, porque es lo que se nota
 * en la factura y lo que nadie avisa de que ha cambiado:
 *
 *   1. Clientes que se movieron de tarifa
 *   2. Tarifas creadas, archivadas, renombradas o borradas
 *   3. Reglas de precio añadidas, quitadas o modificadas
 *
 * Las funciones de aquí son PURAS: reciben dos objetos y devuelven las
 * diferencias. Leer ficheros y pintar es del script que las usa. Así se pueden
 * probar sin tocar disco ni Odoo.
 */

export interface Tarifa {
  id: number;
  name: string;
  currency_id: [number, string] | false;
  company_id: [number, string] | false;
  active?: boolean;
}

export interface ReglaPrecio {
  id: number;
  pricelist_id: [number, string] | false;
  applied_on: string;
  compute_price: string;
  fixed_price: number | false;
  percent_price: number | false;
  product_tmpl_id: [number, string] | false;
  categ_id: [number, string] | false;
  min_quantity: number | false;
  date_start: string | false;
  date_end: string | false;
}

export interface Copia {
  generadoEn: string;
  tarifas: Tarifa[];
  reglasDePrecio: ReglaPrecio[];
  clientesPorTarifa: Array<{ tarifaId: number; clientes: number }>;
}

export interface CambioCampo {
  campo: string;
  antes: unknown;
  ahora: unknown;
}

export interface Diferencias {
  /** Lo primero que hay que mirar: mueve el precio que paga un cliente. */
  clientesPorTarifa: Array<{ tarifaId: number; nombre: string; antes: number; ahora: number }>;
  tarifasNuevas: Tarifa[];
  tarifasDesaparecidas: Tarifa[];
  tarifasCambiadas: Array<{ id: number; nombre: string; cambios: CambioCampo[] }>;
  reglasNuevas: number;
  reglasDesaparecidas: number;
  reglasCambiadas: Array<{ id: number; tarifa: string; producto: string; cambios: CambioCampo[] }>;
  /** true si no cambió absolutamente nada. */
  identicas: boolean;
}

/** Texto legible de un many2one de Odoo, que llega como `[id, nombre]` o `false`. */
function nombreDe(m2o: [number, string] | false, siNo = '—'): string {
  return m2o ? m2o[1] : siNo;
}

const CAMPOS_TARIFA: Array<keyof Tarifa> = ['name', 'currency_id', 'company_id', 'active'];

const CAMPOS_REGLA: Array<keyof ReglaPrecio> = [
  'pricelist_id',
  'applied_on',
  'compute_price',
  'fixed_price',
  'percent_price',
  'product_tmpl_id',
  'categ_id',
  'min_quantity',
  'date_start',
  'date_end',
];

/**
 * Compara campo a campo dos versiones del mismo registro.
 *
 * Se serializa a JSON para comparar: los many2one llegan como array `[id,
 * nombre]` y `a === b` daría siempre distinto al ser objetos diferentes. Y el
 * nombre cuenta a propósito — que una tarifa pase de "Lista USD" a "Lista USD 2"
 * es un cambio que interesa ver.
 */
function compararCampos<T>(antes: T, ahora: T, campos: Array<keyof T>): CambioCampo[] {
  const cambios: CambioCampo[] = [];

  for (const campo of campos) {
    const a = JSON.stringify(antes[campo] ?? null);
    const b = JSON.stringify(ahora[campo] ?? null);
    if (a !== b) {
      cambios.push({ campo: String(campo), antes: antes[campo] ?? null, ahora: ahora[campo] ?? null });
    }
  }

  return cambios;
}

export function comparar(antes: Copia, ahora: Copia): Diferencias {
  // ── Tarifas ───────────────────────────────────────────────────────────────
  const tarifasAntes = new Map(antes.tarifas.map((t) => [t.id, t]));
  const tarifasAhora = new Map(ahora.tarifas.map((t) => [t.id, t]));

  const tarifasNuevas = ahora.tarifas.filter((t) => !tarifasAntes.has(t.id));
  const tarifasDesaparecidas = antes.tarifas.filter((t) => !tarifasAhora.has(t.id));

  const tarifasCambiadas: Diferencias['tarifasCambiadas'] = [];
  for (const [id, t] of tarifasAhora) {
    const previa = tarifasAntes.get(id);
    if (!previa) continue;
    const cambios = compararCampos(previa, t, CAMPOS_TARIFA);
    if (cambios.length > 0) tarifasCambiadas.push({ id, nombre: t.name, cambios });
  }

  // ── Clientes por tarifa ───────────────────────────────────────────────────
  //
  // Se recorre la UNIÓN de las dos copias, no solo la nueva. Una tarifa que se
  // queda sin clientes desaparece del recuento —el script solo cuenta las que
  // tienen alguno—, y ese es justamente el caso que más urge ver.
  const contarAntes = new Map(antes.clientesPorTarifa.map((c) => [c.tarifaId, c.clientes]));
  const contarAhora = new Map(ahora.clientesPorTarifa.map((c) => [c.tarifaId, c.clientes]));

  const clientesPorTarifa: Diferencias['clientesPorTarifa'] = [];
  for (const id of new Set([...contarAntes.keys(), ...contarAhora.keys()])) {
    const a = contarAntes.get(id) ?? 0;
    const b = contarAhora.get(id) ?? 0;
    if (a === b) continue;

    clientesPorTarifa.push({
      tarifaId: id,
      nombre: tarifasAhora.get(id)?.name ?? tarifasAntes.get(id)?.name ?? `(tarifa ${id})`,
      antes: a,
      ahora: b,
    });
  }
  clientesPorTarifa.sort((x, y) => Math.abs(y.ahora - y.antes) - Math.abs(x.ahora - x.antes));

  // ── Reglas de precio ──────────────────────────────────────────────────────
  const reglasAntes = new Map(antes.reglasDePrecio.map((r) => [r.id, r]));
  const reglasAhora = new Map(ahora.reglasDePrecio.map((r) => [r.id, r]));

  let reglasNuevas = 0;
  const reglasCambiadas: Diferencias['reglasCambiadas'] = [];

  for (const [id, r] of reglasAhora) {
    const previa = reglasAntes.get(id);
    if (!previa) {
      reglasNuevas++;
      continue;
    }
    const cambios = compararCampos(previa, r, CAMPOS_REGLA);
    if (cambios.length > 0) {
      reglasCambiadas.push({
        id,
        tarifa: nombreDe(r.pricelist_id),
        producto: nombreDe(r.product_tmpl_id, nombreDe(r.categ_id, '(toda la tarifa)')),
        cambios,
      });
    }
  }

  let reglasDesaparecidas = 0;
  for (const id of reglasAntes.keys()) if (!reglasAhora.has(id)) reglasDesaparecidas++;

  return {
    clientesPorTarifa,
    tarifasNuevas,
    tarifasDesaparecidas,
    tarifasCambiadas,
    reglasNuevas,
    reglasDesaparecidas,
    reglasCambiadas,
    identicas:
      clientesPorTarifa.length === 0 &&
      tarifasNuevas.length === 0 &&
      tarifasDesaparecidas.length === 0 &&
      tarifasCambiadas.length === 0 &&
      reglasNuevas === 0 &&
      reglasDesaparecidas === 0 &&
      reglasCambiadas.length === 0,
  };
}

/** Un valor de Odoo, en corto y legible. */
export function valor(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (v === false) return 'no';
  if (v === true) return 'sí';
  if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string') return v[1];
  return String(v);
}
