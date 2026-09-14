import { prisma } from '../config/prisma.js';

/**
 * Alertas de operación (issue #46).
 *
 * ── Lo que este módulo decide, y lo que no ───────────────────────────────────
 *
 * Aquí solo se EVALÚA: cada regla mira los datos y devuelve una alerta o null.
 * Quién se entera y por dónde es problema de `scripts/alertas.ts`, que es lo que
 * corre el cron.
 *
 * Están separados a propósito. Una alerta que solo existe dentro del middleware
 * muere con él, y "el middleware está caído" es justo la que más importa. Por
 * eso quien evalúa es un proceso aparte que sigue vivo aunque el servidor no.
 *
 * ── Cada alerta lleva su runbook ─────────────────────────────────────────────
 *
 * El criterio de aceptación del issue lo pide, y es lo que separa una alerta útil
 * de una que se aprende a ignorar. A las tres de la mañana nadie razona desde
 * cero: o la alerta dice qué mirar y qué hacer, o se silencia.
 *
 * ── Advertencia sobre el estado real ─────────────────────────────────────────
 *
 * De las siete reglas, hoy solo DOS pueden dispararse con datos reales: el sync
 * y los accesos cruzados. Las otras leen `api_request_logs` y `kiosk_devices`,
 * que están vacías porque la API pública (#30-#33) y el kiosco (Fase 5) todavía
 * no existen. Están escritas y probadas contra datos sembrados; cuando llegue el
 * tráfico empiezan a funcionar solas.
 */

export type Severidad = 'critica' | 'aviso';

export interface Alerta {
  /** Ancla del runbook en docs/05-RUNBOOKS.md. */
  id: string;
  severidad: Severidad;
  titulo: string;
  /** Los números concretos. Sin ellos no se puede decidir nada. */
  detalle: string;
  runbook: string;
}

const RUNBOOKS = 'docs/05-RUNBOOKS.md';

function alerta(
  id: string,
  severidad: Severidad,
  titulo: string,
  detalle: string,
): Alerta {
  return { id, severidad, titulo, detalle, runbook: `${RUNBOOKS}#${id}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Umbrales
//
// Todos configurables por entorno, y todos con un valor por defecto que me he
// inventado con criterio pero SIN datos de producción detrás. Conviene revisarlos
// cuando haya un mes de tráfico real: una alerta mal calibrada se silencia, y una
// alerta silenciada es peor que ninguna porque da sensación de cobertura.
// ─────────────────────────────────────────────────────────────────────────────

function num(clave: string, porDefecto: number): number {
  const v = Number(process.env[clave]);
  return Number.isFinite(v) && v > 0 ? v : porDefecto;
}

export const UMBRALES = {
  /** Horas sin una pasada de sync antes de avisar. El job es horario. */
  get syncHoras() {
    return num('ALERTA_SYNC_HORAS', 6);
  },
  /** Minutos con el cerrojo puesto antes de considerar la pasada colgada. */
  get syncColgadoMin() {
    return num('ALERTA_SYNC_COLGADO_MIN', 30);
  },
  /** Accesos cruzados en la ventana antes de avisar. */
  get accesosCruzados() {
    return num('ALERTA_ACCESOS_CRUZADOS', 5);
  },
  get ventanaMin() {
    return num('ALERTA_VENTANA_MIN', 15);
  },
  /** p95 de Odoo en ms. */
  get odooP95Ms() {
    return num('ALERTA_ODOO_P95_MS', 3000);
  },
  /** Porcentaje de 5xx sobre el total de peticiones de la ventana. */
  get tasa5xx() {
    return num('ALERTA_TASA_5XX', 5);
  },
  /** 401 de una misma key en la ventana. */
  get key401() {
    return num('ALERTA_KEY_401', 10);
  },
  /** Llamadas a Odoo por petición a partir de las cuales huele a N+1. */
  get odooCallsPorPeticion() {
    return num('ALERTA_ODOO_CALLS', 5);
  },
  /** Minutos sin señal de un kiosco en horario laboral. */
  get kioscoMin() {
    return num('ALERTA_KIOSCO_MIN', 30);
  },
};

const haceMinutos = (min: number) => new Date(Date.now() - min * 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Reglas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El job de sincronización no corre, o se quedó colgado.
 *
 * Dos fallos distintos con el mismo síntoma para el usuario —los clientes nuevos
 * de Odoo no aparecen en el panel— pero con arreglos opuestos: uno es reiniciar
 * el cron, el otro es soltar un cerrojo. Por eso se distinguen aquí.
 */
export async function reglaSync(): Promise<Alerta | null> {
  const estado = await prisma.syncState.findUnique({ where: { entidad: 'res.partner' } });

  if (!estado) {
    return alerta(
      'sync-nunca',
      'aviso',
      'La sincronización de clientes no se ha ejecutado nunca',
      'No hay fila en `sync_state` para `res.partner`. O el job no está programado, o nunca llegó a terminar una pasada.',
    );
  }

  if (estado.ejecutando && estado.ejecutandoDesde) {
    const minutos = Math.round((Date.now() - estado.ejecutandoDesde.getTime()) / 60_000);
    if (minutos >= UMBRALES.syncColgadoMin) {
      return alerta(
        'sync-colgado',
        'critica',
        'La sincronización lleva demasiado tiempo "ejecutando"',
        `El cerrojo está puesto desde hace ${minutos} min (umbral ${UMBRALES.syncColgadoMin}). ` +
          'Mientras siga así, ninguna pasada nueva puede arrancar.',
      );
    }
  }

  if (!estado.ultimaEjecucion) {
    return alerta(
      'sync-nunca',
      'aviso',
      'La sincronización de clientes no ha terminado ninguna pasada',
      'Existe la fila de estado pero sin `ultima_ejecucion`.',
    );
  }

  const horas = (Date.now() - estado.ultimaEjecucion.getTime()) / 3_600_000;
  if (horas >= UMBRALES.syncHoras) {
    return alerta(
      'sync-atrasado',
      'critica',
      'La sincronización de clientes está atrasada',
      `Última pasada hace ${horas.toFixed(1)} h (umbral ${UMBRALES.syncHoras} h). ` +
        'Los clientes dados de alta en Odoo desde entonces no pueden entrar al panel.',
    );
  }

  return null;
}

/**
 * Varios accesos cruzados en poco tiempo.
 *
 * Esta es la que #44 dejó pendiente aquí, y la que más pesa: al salir de
 * PostgreSQL se perdió el RLS, así que el aislamiento entre carteras depende
 * solo del scoping del middleware. Un intento suelto es ruido normal —un enlace
 * viejo, una cartera que cambió de manos—. Varios seguidos son una de dos cosas,
 * y las dos hay que mirarlas: o hay un bug de scoping, o alguien está probando.
 */
export interface AccesoDenegado {
  actorEmail: string | null;
  targetId: string | null;
}

/**
 * La DECISIÓN, separada de la consulta.
 *
 * Están partidas por una razón concreta: `audit_logs` es una tabla compartida
 * que escribe todo el sistema, así que un test que siembre filas y luego cuente
 * el total depende de lo que estén haciendo los demás. Eso se vio al correr la
 * batería entera —los tests de aislamiento generan accesos denegados de verdad
 * en paralelo, y la regla los contaba—, y la salida fácil habría sido estrechar
 * la regla para que el test pasara. Eso es justo lo que no se puede hacer: la
 * regla tiene que contarlo TODO, porque en producción "todo" es la señal.
 *
 * Así, la lógica se prueba a fondo con datos inventados y de forma determinista,
 * y la consulta se comprueba aparte con que corra.
 */
export function evaluarAccesosCruzados(eventos: AccesoDenegado[]): Alerta | null {
  if (eventos.length < UMBRALES.accesosCruzados) return null;

  const porActor = new Map<string, number>();
  for (const e of eventos) {
    const k = e.actorEmail ?? '(sin identificar)';
    porActor.set(k, (porActor.get(k) ?? 0) + 1);
  }

  const top = [...porActor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([quien, n]) => `${quien} (${n})`)
    .join(', ');

  return alerta(
    'accesos-cruzados',
    'critica',
    'Varios intentos de acceso a clientes ajenos',
    `${eventos.length} en ${UMBRALES.ventanaMin} min (umbral ${UMBRALES.accesosCruzados}). ` +
      `Quien más lo intenta: ${top}. Clientes distintos afectados: ` +
      `${new Set(eventos.map((e) => e.targetId)).size}.`,
  );
}

export async function reglaAccesosCruzados(): Promise<Alerta | null> {
  const eventos = await prisma.auditLog.findMany({
    where: {
      action: 'access.denied.partner',
      createdAt: { gte: haceMinutos(UMBRALES.ventanaMin) },
    },
    select: { actorEmail: true, targetId: true },
  });

  return evaluarAccesosCruzados(eventos);
}

/** Odoo responde, pero lento. Lo nota el vendedor antes que el monitor. */
export function reglaLatenciaOdoo(latencia: {
  muestras: number;
  p95: number | null;
}): Alerta | null {
  // Sin muestras no se dice nada. "No hay datos" no es "todo bien", y avisar de
  // un p95 calculado sobre tres llamadas es la forma más rápida de que la gente
  // deje de mirar estas alertas.
  if (latencia.muestras < 20 || latencia.p95 === null) return null;

  if (latencia.p95 < UMBRALES.odooP95Ms) return null;

  return alerta(
    'odoo-lento',
    'aviso',
    'Odoo está respondiendo lento',
    `p95 de ${latencia.p95} ms sobre ${latencia.muestras} llamadas ` +
      `(umbral ${UMBRALES.odooP95Ms} ms).`,
  );
}

/** El middleware no responde, o responde que está a medias. */
export function reglaSalud(estado: {
  alcanzable: boolean;
  status?: string;
  detalle?: string;
}): Alerta | null {
  if (!estado.alcanzable) {
    return alerta(
      'middleware-caido',
      'critica',
      'El middleware no responde',
      estado.detalle ?? 'Sin respuesta de /health.',
    );
  }

  if (estado.status !== 'ok') {
    return alerta(
      'middleware-degradado',
      'critica',
      'El middleware responde pero alguna dependencia está caída',
      estado.detalle ?? `/health devolvió status "${estado.status}".`,
    );
  }

  return null;
}

// ── Reglas sobre api_request_logs ────────────────────────────────────────────
//
// Las cuatro de abajo leen la bitácora de la API pública. Hoy está VACÍA: los
// endpoints públicos son los issues #30-#33 y todavía no existen, así que estas
// reglas nunca disparan. Están escritas y probadas contra datos sembrados para
// que el día que llegue el tráfico ya estén en su sitio, no para simular
// cobertura que no hay.

/**
 * Muchos 401 de una misma key.
 *
 * Dos lecturas, y conviene no elegir una antes de mirar: o la integración del
 * cliente se rompió —rotaron algo y no se enteraron— o alguien está probando una
 * key que se filtró. El runbook las separa.
 */
export async function regla401PorKey(): Promise<Alerta | null> {
  const desde = haceMinutos(UMBRALES.ventanaMin);

  const filas = await prisma.apiRequestLog.groupBy({
    by: ['apiKeyId'],
    where: { statusCode: 401, createdAt: { gte: desde }, apiKeyId: { not: null } },
    _count: { _all: true },
  });

  const culpables = filas
    .filter((f) => f._count._all >= UMBRALES.key401)
    .sort((a, b) => b._count._all - a._count._all);

  if (culpables.length === 0) return null;

  return alerta(
    'key-401',
    'critica',
    'Una API key está acumulando rechazos',
    culpables
      .slice(0, 5)
      .map((c) => `key ${c.apiKeyId}: ${c._count._all} rechazos en ${UMBRALES.ventanaMin} min`)
      .join(' · '),
  );
}

/** Demasiados errores del servidor. Esto es culpa nuestra, no del cliente. */
export async function regla5xx(): Promise<Alerta | null> {
  const desde = haceMinutos(UMBRALES.ventanaMin);

  const [total, errores] = await Promise.all([
    prisma.apiRequestLog.count({ where: { createdAt: { gte: desde } } }),
    prisma.apiRequestLog.count({ where: { createdAt: { gte: desde }, statusCode: { gte: 500 } } }),
  ]);

  // Con poco tráfico un solo error dispara cualquier porcentaje. Se exige un
  // mínimo de peticiones para que la tasa signifique algo.
  if (total < 20) return null;

  const tasa = (errores / total) * 100;
  if (tasa < UMBRALES.tasa5xx) return null;

  return alerta(
    'tasa-5xx',
    'critica',
    'Tasa alta de errores del servidor en la API pública',
    `${errores} de ${total} peticiones (${tasa.toFixed(1)} %) en ${UMBRALES.ventanaMin} min, ` +
      `umbral ${UMBRALES.tasa5xx} %.`,
  );
}

/**
 * Peticiones que hacen demasiadas llamadas a Odoo.
 *
 * Es la firma de un N+1 contra el ERP: una petición que consulta cliente por
 * cliente en vez de en lote. No rompe nada —por eso no sale en ninguna otra
 * alerta— pero multiplica la latencia y el consumo de la cuota de Odoo, y crece
 * con el número de clientes hasta que un día deja de caber.
 */
export async function reglaNMasUno(): Promise<Alerta | null> {
  const desde = haceMinutos(UMBRALES.ventanaMin);

  const peores = await prisma.apiRequestLog.findMany({
    where: { createdAt: { gte: desde }, odooCalls: { gt: UMBRALES.odooCallsPorPeticion } },
    select: { path: true, method: true, odooCalls: true, durationMs: true },
    orderBy: { odooCalls: 'desc' },
    take: 5,
  });

  if (peores.length === 0) return null;

  return alerta(
    'odoo-n-mas-uno',
    'aviso',
    'Peticiones haciendo demasiadas llamadas a Odoo',
    peores
      .map((p) => `${p.method} ${p.path}: ${p.odooCalls} RPC en ${p.durationMs} ms`)
      .join(' · '),
  );
}

/**
 * Un kiosco callado en horario laboral.
 *
 * Fuera de horario el silencio es lo normal —la tienda está cerrada— y avisar
 * entonces entrena a la gente a ignorar la alerta. La franja y la zona horaria
 * son configurables porque la tienda no está en UTC.
 */
export async function reglaKioscos(ahora = new Date()): Promise<Alerta | null> {
  const zona = process.env.ALERTA_KIOSCO_TZ ?? 'America/Caracas';
  const abre = num('ALERTA_KIOSCO_ABRE', 8);
  const cierra = num('ALERTA_KIOSCO_CIERRA', 19);

  const hora = Number(
    new Intl.DateTimeFormat('es-VE', {
      timeZone: zona,
      hour: 'numeric',
      hour12: false,
    }).format(ahora),
  );

  if (hora < abre || hora >= cierra) return null;

  const mudos = await prisma.kioskDevice.findMany({
    where: { isActive: true, lastSeenAt: { lt: haceMinutos(UMBRALES.kioscoMin) } },
    select: { label: true, lastSeenAt: true },
    take: 10,
  });

  if (mudos.length === 0) return null;

  return alerta(
    'kiosco-mudo',
    'aviso',
    'Kioscos sin dar señales en horario laboral',
    mudos
      .map((k) => `${k.label}: sin señal desde ${k.lastSeenAt?.toISOString() ?? 'nunca'}`)
      .join(' · '),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evalúa todas las reglas que dependen de la base.
 *
 * Cada una va en su propio try: si una falla —una tabla que no existe todavía,
 * un permiso que falta— las demás tienen que seguir evaluándose. Un comprobador
 * de alertas que se cae entero por una regla rota deja de avisar de TODO, y sin
 * hacer ruido.
 */
export async function evaluarReglasDeBase(): Promise<{
  alertas: Alerta[];
  fallos: string[];
}> {
  const reglas: Array<[string, () => Promise<Alerta | null>]> = [
    ['sync', reglaSync],
    ['accesos-cruzados', reglaAccesosCruzados],
    ['key-401', regla401PorKey],
    ['tasa-5xx', regla5xx],
    ['n+1', reglaNMasUno],
    ['kioscos', () => reglaKioscos()],
  ];

  const alertas: Alerta[] = [];
  const fallos: string[] = [];

  for (const [nombre, fn] of reglas) {
    try {
      const a = await fn();
      if (a) alertas.push(a);
    } catch (error) {
      fallos.push(`${nombre}: ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  return { alertas, fallos };
}
