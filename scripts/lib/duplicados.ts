/**
 * Detección de clientes duplicados en Odoo (#50).
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * El issue dice "61,8% de los registros de cliente están duplicados". Ese número
 * es cierto y no se puede hacer nada con él: suena a una migración de datos de
 * semanas, y por eso lleva meses abierto.
 *
 * La realidad tiene mucha mejor forma. La mayoría de los duplicados son
 * inofensivos —registros sin una sola factura, o grupos donde toda la
 * facturación está en un único registro— y el panel muestra la cifra correcta.
 * Lo que rompe el panel es otra cosa, mucho más pequeña: los grupos donde la
 * facturación está REPARTIDA entre varios registros. Ahí el vendedor abre un
 * cliente y ve una fracción de la relación comercial, con un número que es
 * exacto para ese registro y falso como retrato del cliente.
 *
 * Este módulo separa lo uno de lo otro y ordena por dinero, para convertir
 * "tenemos un problema de datos" en "fusiona estos veinte".
 *
 * ── Por qué el RIF y no el nombre ────────────────────────────────────────────
 *
 * Dos registros con el mismo RIF SON la misma entidad legal. No hay
 * interpretación posible, y en esta instancia el campo está relleno en el 99% de
 * los clientes.
 *
 * El nombre es una heurística: "SUPRICOM CCS 21, C.A." y "SUPRICOM CCS 21 CA"
 * son lo mismo, pero dos empresas distintas pueden llamarse igual. Por eso los
 * grupos por RIF y por nombre se marcan de forma distinta — los primeros se
 * pueden fusionar con confianza, los segundos hay que mirarlos.
 */

export interface Registro {
  id: number;
  nombre: string;
  rif: string | null;
  vendedorId: number | null;
  vendedor: string | null;
  facturas: number;
  monto: number;
}

export type Motivo = 'rif' | 'nombre';

/** En qué medida un grupo afecta a lo que ve el vendedor. */
export type Clase =
  /** Ningún registro tiene facturas. No afecta a nada. */
  | 'sin-facturas'
  /** Toda la facturación está en un registro. El panel muestra bien. */
  | 'inocuo'
  /** La facturación está repartida. AQUÍ se rompe el panel. */
  | 'partido';

export interface Grupo {
  clave: string;
  motivo: Motivo;
  clase: Clase;
  registros: Registro[];
  /** Cuántos registros del grupo tienen al menos una factura. */
  conFacturas: number;
  /** Facturación sumada de todo el grupo: lo que debería ver el vendedor. */
  montoTotal: number;
  /**
   * Lo que está FUERA del registro con más facturación.
   *
   * Es la medida del trabajo de fusión, no del daño: el daño es que ninguno de
   * los registros enseña la cifra buena.
   */
  montoFuera: number;
  /** Id del registro con más facturación: el destino natural de la fusión. */
  principal: number;
  /**
   * Vendedores distintos entre los registros del grupo.
   *
   * Si hay más de uno, fusionar mueve facturación de una cartera a otra. Eso
   * tiene consecuencias de comisión y no es una decisión técnica: hay que
   * avisarlo antes, no descubrirlo después.
   */
  vendedores: string[];
}

/**
 * Normaliza un RIF venezolano.
 *
 * `J-40872674-2` y `J408726742` son el mismo. Se quita todo lo que no sea letra
 * o dígito.
 */
export function normalizarRif(rif: string | null | undefined): string | null {
  if (!rif) return null;
  const limpio = String(rif).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpio.length > 0 ? limpio : null;
}

/**
 * ¿Sirve este RIF para agrupar?
 *
 * Los campos de identificación fiscal se rellenan a mano y acaban llenos de
 * marcadores: ceros, unos repetidos, "NA", "SIN". Agrupar por esos junta
 * clientes que no tienen nada que ver y llena el informe de ruido — que es
 * exactamente lo que hace que un informe deje de leerse.
 */
export function rifUtilizable(rif: string | null): boolean {
  if (!rif || rif.length < 6) return false;

  const digitos = rif.replace(/[^0-9]/g, '');
  if (digitos.length < 5) return false;

  // Todos los dígitos iguales: 000000000, 111111111…
  if (/^(\d)\1+$/.test(digitos)) return false;

  return true;
}

/**
 * Normaliza un nombre para compararlo.
 *
 * Se quitan la puntuación y los espacios de más. NO se quitan las formas
 * societarias —C.A., S.A., LLC— a propósito: "INVERSIONES PULSAR, C.A." y
 * "INVERSIONES PULSAR, S.A." son dos entidades legales distintas, y juntarlas
 * sería inventar un duplicado.
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .toUpperCase()
    .replace(/[.,;:()"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function construirGrupo(clave: string, motivo: Motivo, registros: Registro[]): Grupo {
  const conFacturas = registros.filter((r) => r.facturas > 0);
  const montoTotal = registros.reduce((s, r) => s + r.monto, 0);

  // El principal es el de más facturación; con empate, el de id más bajo, que
  // suele ser el más antiguo y por tanto el que más referencias arrastra.
  const principal = [...registros].sort((a, b) => b.monto - a.monto || a.id - b.id)[0];

  const clase: Clase =
    conFacturas.length === 0 ? 'sin-facturas' : conFacturas.length === 1 ? 'inocuo' : 'partido';

  return {
    clave,
    motivo,
    clase,
    registros: [...registros].sort((a, b) => b.monto - a.monto || a.id - b.id),
    conFacturas: conFacturas.length,
    montoTotal,
    montoFuera: montoTotal - principal.monto,
    principal: principal.id,
    vendedores: [...new Set(registros.map((r) => r.vendedor).filter((v): v is string => !!v))],
  };
}

/**
 * Agrupa los registros y clasifica cada grupo.
 *
 * Un registro solo cae en UN grupo. Se agrupa primero por RIF —que es
 * concluyente— y solo los que quedan sueltos se intentan por nombre. Si no fuera
 * así, el mismo cliente aparecería dos veces en el informe y quien lo lea tendría
 * que deduplicar el informe de duplicados.
 */
export function agrupar(registros: Registro[]): Grupo[] {
  const grupos: Grupo[] = [];
  const yaAgrupado = new Set<number>();

  // ── 1. Por RIF ────────────────────────────────────────────────────────────
  const porRif = new Map<string, Registro[]>();
  for (const r of registros) {
    const rif = normalizarRif(r.rif);
    if (!rifUtilizable(rif)) continue;
    if (!porRif.has(rif!)) porRif.set(rif!, []);
    porRif.get(rif!)!.push(r);
  }

  for (const [rif, rs] of porRif) {
    if (rs.length < 2) continue;
    grupos.push(construirGrupo(rif, 'rif', rs));
    for (const r of rs) yaAgrupado.add(r.id);
  }

  // ── 2. Por nombre, solo lo que quedó suelto ───────────────────────────────
  const porNombre = new Map<string, Registro[]>();
  for (const r of registros) {
    if (yaAgrupado.has(r.id)) continue;
    const n = normalizarNombre(r.nombre);
    if (n.length === 0) continue;
    if (!porNombre.has(n)) porNombre.set(n, []);
    porNombre.get(n)!.push(r);
  }

  for (const [nombre, rs] of porNombre) {
    if (rs.length < 2) continue;
    grupos.push(construirGrupo(nombre, 'nombre', rs));
  }

  // Lo que más dinero tiene repartido, primero: es por donde hay que empezar.
  return grupos.sort((a, b) => b.montoTotal - a.montoTotal);
}

export interface Resumen {
  registros: number;
  grupos: number;
  sinFacturas: number;
  inocuos: number;
  partidos: number;
  /** Facturación atrapada en grupos partidos. */
  montoPartido: number;
  montoTotalFacturado: number;
  /** Grupos partidos cuyos registros pertenecen a vendedores distintos. */
  partidosEntreVendedores: number;
}

export function resumir(grupos: Grupo[], registros: Registro[]): Resumen {
  const partidos = grupos.filter((g) => g.clase === 'partido');

  return {
    registros: registros.length,
    grupos: grupos.length,
    sinFacturas: grupos.filter((g) => g.clase === 'sin-facturas').length,
    inocuos: grupos.filter((g) => g.clase === 'inocuo').length,
    partidos: partidos.length,
    montoPartido: partidos.reduce((s, g) => s + g.montoTotal, 0),
    montoTotalFacturado: registros.reduce((s, r) => s + r.monto, 0),
    partidosEntreVendedores: partidos.filter((g) => g.vendedores.length > 1).length,
  };
}

/**
 * Cuántos grupos hacen falta para cubrir un porcentaje del dinero repartido.
 *
 * Es el número que convierte el issue en algo accionable: no "hay 85 grupos
 * rotos" sino "con los N primeros se arregla el 90%".
 */
export function gruposParaCubrir(grupos: Grupo[], porcentaje: number): number {
  const partidos = grupos.filter((g) => g.clase === 'partido');
  const total = partidos.reduce((s, g) => s + g.montoTotal, 0);
  if (total === 0) return 0;

  const objetivo = total * (porcentaje / 100);
  let acumulado = 0;

  for (let i = 0; i < partidos.length; i++) {
    acumulado += partidos[i].montoTotal;
    if (acumulado >= objetivo) return i + 1;
  }

  return partidos.length;
}
