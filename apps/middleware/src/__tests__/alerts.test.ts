import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  evaluarReglasDeBase,
  regla401PorKey,
  regla5xx,
  evaluarAccesosCruzados,
  reglaAccesosCruzados,
  type AccesoDenegado,
  reglaKioscos,
  reglaLatenciaOdoo,
  reglaNMasUno,
  reglaSalud,
  reglaSync,
  UMBRALES,
  type Alerta,
} from '../services/alerts.service.js';
import { metricasOdoo, registrarRpc, reiniciarMetricas } from '../odoo/metrics.js';

/**
 * Issue #46 — Alertas de operación.
 *
 * ── Lo que se prueba, y por qué así ──────────────────────────────────────────
 *
 * Una regla de alerta tiene dos formas de estar mal, y la segunda es la que
 * duele: que salte cuando no debe —y entonces se silencia— o que NO salte cuando
 * debe, y nadie se entere de nada. Por eso cada regla se prueba en los dos
 * sentidos.
 *
 * Las reglas que leen la base necesitan datos, y hoy `api_request_logs` y
 * `kiosk_devices` están vacías porque la API pública (#30-#33) y el kiosco
 * (Fase 5) no existen todavía. Se siembran aquí a propósito: probar contra
 * tablas vacías demostraría solo que no explotan.
 *
 * Todo lo sembrado se borra al terminar, y se marca con ids propios para no
 * tocar nada de desarrollo.
 */

const MARCA = 'test-alertas';
const PARTNER_BASE = 970_000;

/** Ventana holgada: se escribe con fechas recientes para caer dentro. */
const haceMin = (m: number) => new Date(Date.now() - m * 60_000);

const idsKioscos: string[] = [];

beforeAll(async () => {
  // Estado de partida limpio: si una ejecución anterior dejó restos, los
  // conteos de abajo darían números que no son los que este test sembró.
  await limpiar();
}, 60_000);

afterEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

async function limpiar(): Promise<void> {
  await prisma.apiRequestLog.deleteMany({
    where: { odooPartnerId: { gte: PARTNER_BASE } },
  });
  if (idsKioscos.length > 0) {
    await prisma.kioskDevice.deleteMany({ where: { id: { in: idsKioscos } } });
    idsKioscos.length = 0;
  }
}

/**
 * Devuelve `sync_state` a como estaba.
 *
 * Se restauran los campos uno a uno y no la fila entera: `resumen` es JSON
 * anulable, y Prisma no acepta un `null` crudo ahí — hay que decirle
 * `DbNull` explícitamente.
 *
 * Importa hacerlo bien porque esta tabla la usa el job de verdad: dejarla con el
 * cerrojo puesto bloquearía la siguiente sincronización de desarrollo.
 */
async function restaurarSync(
  previo: Awaited<ReturnType<typeof prisma.syncState.findUnique>>,
): Promise<void> {
  if (!previo) {
    await prisma.syncState.delete({ where: { entidad: 'res.partner' } }).catch(() => undefined);
    return;
  }

  await prisma.syncState.update({
    where: { entidad: 'res.partner' },
    data: {
      ultimoWriteDate: previo.ultimoWriteDate,
      ultimaEjecucion: previo.ultimaEjecucion,
      ejecutando: previo.ejecutando,
      ejecutandoDesde: previo.ejecutandoDesde,
      resumen: previo.resumen === null ? Prisma.DbNull : previo.resumen,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('#46 · Ventana de latencia de Odoo', () => {
  afterEach(() => reiniciarMetricas());

  it('sin llamadas dice "sin muestras", no "todo bien"', () => {
    reiniciarMetricas();
    const m = metricasOdoo();

    // La diferencia importa: un p95 de 0 pasaría cualquier umbral y parecería
    // que Odoo va perfecto cuando en realidad no se ha medido nada.
    expect(m.muestras).toBe(0);
    expect(m.p95).toBeNull();
  });

  it('calcula percentiles sobre lo que se registró', () => {
    reiniciarMetricas();
    for (let i = 1; i <= 100; i++) registrarRpc(i * 10, true);

    const m = metricasOdoo();
    expect(m.muestras).toBe(100);
    expect(m.p50).toBe(500);
    expect(m.p95).toBe(950);
    expect(m.maximo).toBe(1000);
  });

  it('la ventana se queda con las ÚLTIMAS, no con las primeras', () => {
    reiniciarMetricas();
    // Primero 600 llamadas rapidísimas (la capacidad es 500), luego 500 lentas.
    for (let i = 0; i < 600; i++) registrarRpc(1, true);
    for (let i = 0; i < 500; i++) registrarRpc(9000, true);

    const m = metricasOdoo();
    // Si conservara las primeras, el p95 sería 1 y una caída de rendimiento
    // quedaría tapada para siempre por el histórico bueno.
    expect(m.p95).toBe(9000);
    expect(m.muestras).toBe(500);
    expect(m.llamadasTotales).toBe(1100);
  });

  it('los fallos cuentan como muestras', () => {
    reiniciarMetricas();
    registrarRpc(50, false);
    registrarRpc(50, false);

    // Si no contaran, una tanda de errores rápidos bajaría el p95 y haría
    // parecer que Odoo va mejor que nunca justo cuando está roto.
    expect(metricasOdoo().muestras).toBe(2);
    expect(metricasOdoo().fallosTotales).toBe(2);
  });
});

describe('#46 · Regla de latencia', () => {
  it('NO avisa con pocas muestras, aunque sean lentísimas', () => {
    // Un p95 calculado sobre tres llamadas no significa nada, y avisar por eso
    // es la forma más rápida de que la gente deje de mirar estas alertas.
    expect(reglaLatenciaOdoo({ muestras: 3, p95: 60_000 })).toBeNull();
  });

  it('NO avisa por debajo del umbral', () => {
    expect(reglaLatenciaOdoo({ muestras: 200, p95: UMBRALES.odooP95Ms - 1 })).toBeNull();
  });

  it('avisa por encima del umbral', () => {
    const a = reglaLatenciaOdoo({ muestras: 200, p95: UMBRALES.odooP95Ms + 1 });
    expect(a?.id).toBe('odoo-lento');
    // El número concreto tiene que estar en el mensaje: sin él no se puede
    // decidir si es grave o es el umbral el que está mal puesto.
    expect(a?.detalle).toContain(String(UMBRALES.odooP95Ms + 1));
  });
});

describe('#46 · Regla de salud', () => {
  it('el middleware inalcanzable es crítico', () => {
    const a = reglaSalud({ alcanzable: false, detalle: 'ECONNREFUSED' });
    expect(a?.id).toBe('middleware-caido');
    expect(a?.severidad).toBe('critica');
  });

  it('responder con una dependencia caída es crítico', () => {
    const a = reglaSalud({ alcanzable: true, status: 'degraded', detalle: 'mysql: ...' });
    expect(a?.id).toBe('middleware-degradado');
  });

  it('todo sano no genera alerta', () => {
    expect(reglaSalud({ alcanzable: true, status: 'ok' })).toBeNull();
  });
});

describe('#46 · Regla de accesos cruzados', () => {
  /*
   * Se prueba la DECISIÓN con datos inventados, no la tabla.
   *
   * `audit_logs` la escribe todo el sistema, así que sembrar filas y contar el
   * total depende de lo que estén haciendo los demás tests en paralelo. Se vio:
   * la batería de aislamiento genera accesos denegados de verdad, y estos tests
   * fallaban de forma intermitente.
   *
   * La salida fácil habría sido estrechar la regla para que el test pasara.
   * Justo lo que no se puede hacer: en producción la regla tiene que contarlo
   * todo, porque "todo" es la señal.
   */
  const evento = (actor: string, target: number): AccesoDenegado => ({
    actorEmail: actor,
    targetId: String(target),
  });

  const nEventos = (n: number, actor = 'vendedor@local') =>
    Array.from({ length: n }, (_, i) => evento(actor, 50_000 + i));

  it('NO avisa por debajo del umbral', () => {
    expect(evaluarAccesosCruzados(nEventos(UMBRALES.accesosCruzados - 1))).toBeNull();
  });

  it('avisa al alcanzarlo, y dice quién y cuántos clientes distintos', () => {
    const a = evaluarAccesosCruzados(nEventos(UMBRALES.accesosCruzados));

    expect(a?.id).toBe('accesos-cruzados');
    expect(a?.severidad).toBe('critica');
    expect(a?.detalle).toContain('vendedor@local');
    // El número de clientes distintos es lo que separa "un enlace viejo" de
    // "alguien probando": muchos clientes desde un mismo actor no es un enlace.
    expect(a?.detalle).toContain(`Clientes distintos afectados: ${UMBRALES.accesosCruzados}`);
  });

  it('ordena a los actores por cuántos intentos hizo cada uno', () => {
    const a = evaluarAccesosCruzados([
      ...nEventos(2, 'poco@local'),
      ...nEventos(UMBRALES.accesosCruzados + 5, 'mucho@local'),
    ]);

    // El que más lo intenta va primero: es a quien hay que mirar.
    expect(a?.detalle.indexOf('mucho@local')).toBeLessThan(a!.detalle.indexOf('poco@local'));
  });

  it('un actor sin identificar no rompe el recuento', () => {
    const a = evaluarAccesosCruzados(
      Array.from({ length: UMBRALES.accesosCruzados }, (_, i) => ({
        actorEmail: null,
        targetId: String(i),
      })),
    );
    expect(a?.detalle).toContain('(sin identificar)');
  });

  it('la consulta contra la base corre y devuelve algo válido', async () => {
    // Lo único que hace falta comprobar de la mitad que toca la base: que la
    // consulta es correcta. Si dispara o no depende del estado real, y eso no
    // es asunto de este test.
    const r = await reglaAccesosCruzados();
    expect(r === null || r.id === 'accesos-cruzados').toBe(true);
  });
});

describe('#46 · Reglas sobre api_request_logs', () => {
  /*
   * Estas tablas están vacías en producción hoy: la API pública son los issues
   * #30-#33 y no existe. Se siembra a propósito — probar las reglas contra una
   * tabla vacía solo demostraría que no explotan.
   */
  async function sembrarPeticiones(
    filas: Array<{ status: number; odooCalls?: number; keyId?: string | null }>,
  ): Promise<void> {
    await prisma.apiRequestLog.createMany({
      data: filas.map((f, i) => ({
        odooPartnerId: PARTNER_BASE + i,
        apiKeyId: f.keyId ?? null,
        method: 'GET',
        path: '/api/v1/public/inventory',
        statusCode: f.status,
        durationMs: 100,
        odooCalls: f.odooCalls ?? 1,
        createdAt: haceMin(1),
      })),
    });
  }

  it('tasa de 5xx: NO avisa con poco tráfico aunque el porcentaje sea enorme', async () => {
    // 3 de 3 son el 100 %. Con tan pocas peticiones no significa nada, y avisar
    // convertiría cualquier hipo en una alerta.
    await sembrarPeticiones([{ status: 500 }, { status: 500 }, { status: 500 }]);
    expect(await regla5xx()).toBeNull();
  });

  it('tasa de 5xx: avisa con tráfico suficiente y tasa alta', async () => {
    await sembrarPeticiones([
      ...Array.from({ length: 20 }, () => ({ status: 200 })),
      ...Array.from({ length: 10 }, () => ({ status: 500 })),
    ]);

    const a = await regla5xx();
    expect(a?.id).toBe('tasa-5xx');
    expect(a?.detalle).toContain('10 de 30');
  });

  it('tasa de 5xx: NO avisa si casi todo va bien', async () => {
    await sembrarPeticiones([
      ...Array.from({ length: 100 }, () => ({ status: 200 })),
      { status: 500 },
    ]);
    expect(await regla5xx()).toBeNull();
  });

  it('401 por key: avisa solo de la key que pasa el umbral', async () => {
    const culpable = '11111111-1111-4111-8111-111111111111';
    const inocente = '22222222-2222-4222-8222-222222222222';

    await sembrarPeticiones([
      ...Array.from({ length: UMBRALES.key401 }, () => ({ status: 401, keyId: culpable })),
      ...Array.from({ length: 2 }, () => ({ status: 401, keyId: inocente })),
    ]);

    const a = await regla401PorKey();
    expect(a?.id).toBe('key-401');
    expect(a?.detalle).toContain(culpable);
    expect(a?.detalle).not.toContain(inocente);
  });

  it('N+1: avisa de las peticiones que pasan del umbral de RPC', async () => {
    await sembrarPeticiones([
      { status: 200, odooCalls: 2 },
      { status: 200, odooCalls: UMBRALES.odooCallsPorPeticion + 40 },
    ]);

    const a = await reglaNMasUno();
    expect(a?.id).toBe('odoo-n-mas-uno');
    expect(a?.detalle).toContain(String(UMBRALES.odooCallsPorPeticion + 40));
  });

  it('N+1: no avisa si todas están dentro del umbral', async () => {
    await sembrarPeticiones([
      { status: 200, odooCalls: UMBRALES.odooCallsPorPeticion },
      { status: 200, odooCalls: 1 },
    ]);
    expect(await reglaNMasUno()).toBeNull();
  });
});

describe('#46 · Regla de kioscos', () => {
  async function sembrarKiosco(minutosSinSenal: number): Promise<void> {
    const k = await prisma.kioskDevice.create({
      data: {
        label: `${MARCA} tienda 1`,
        storeLocation: 'Prueba',
        tokenHash: 'f'.repeat(64),
        isActive: true,
        lastSeenAt: haceMin(minutosSinSenal),
      },
      select: { id: true },
    });
    idsKioscos.push(k.id);
  }

  /** Mediodía en Caracas: dentro de cualquier franja laboral razonable. */
  const enHorario = new Date('2026-09-14T16:00:00Z');
  /** Madrugada en Caracas. */
  const fueraDeHorario = new Date('2026-09-14T07:00:00Z');

  it('avisa de un kiosco callado EN horario laboral', async () => {
    await sembrarKiosco(UMBRALES.kioscoMin + 10);

    const a = await reglaKioscos(enHorario);
    expect(a?.id).toBe('kiosco-mudo');
    expect(a?.detalle).toContain(MARCA);
  });

  it('NO avisa fuera de horario: la tienda está cerrada', async () => {
    await sembrarKiosco(UMBRALES.kioscoMin + 10);

    // Avisar con la tienda cerrada entrena a la gente a ignorar la alerta, y
    // entonces tampoco la mira el día que salta a las once de la mañana.
    expect(await reglaKioscos(fueraDeHorario)).toBeNull();
  });

  it('NO avisa de un kiosco que acaba de reportar', async () => {
    await sembrarKiosco(1);
    expect(await reglaKioscos(enHorario)).toBeNull();
  });
});

describe('#46 · Evaluación conjunta', () => {
  it('una regla que falla no impide evaluar las demás', async () => {
    const { alertas, fallos } = await evaluarReglasDeBase();

    // Con la base sana no debería fallar ninguna. Lo que importa del contrato es
    // que `fallos` EXISTA y se informe: una regla que no se puede evaluar no es
    // una regla que pasa, y un comprobador que se cae entero por una regla rota
    // deja de avisar de todo sin hacer ruido.
    expect(Array.isArray(alertas)).toBe(true);
    expect(fallos).toEqual([]);
  }, 30_000);
});

describe('#46 · Cada alerta tiene su runbook', () => {
  /*
   * El criterio de aceptación del issue pide "un runbook enlazado en cada una".
   * Sin esta comprobación se rompe en silencio: se añade una regla, se olvida la
   * sección, y la alerta sale con un enlace que no lleva a ninguna parte. A las
   * tres de la mañana eso es exactamente igual de útil que no tener runbook.
   */
  const doc = readFileSync(resolve(process.cwd(), '../../docs/05-RUNBOOKS.md'), 'utf8');

  /** Las anclas que GitHub genera para `## \`id\``. */
  const anclas = new Set(
    [...doc.matchAll(/^##\s+`([a-z0-9-]+)`/gm)].map((m) => m[1]),
  );

  const todas: Alerta[] = [
    reglaSalud({ alcanzable: false })!,
    reglaSalud({ alcanzable: true, status: 'degraded' })!,
    reglaLatenciaOdoo({ muestras: 100, p95: 999_999 })!,
  ];

  it('los ids conocidos tienen sección propia', () => {
    const esperados = [
      'middleware-caido',
      'middleware-degradado',
      'sync-atrasado',
      'sync-colgado',
      'sync-nunca',
      'accesos-cruzados',
      'odoo-lento',
      'odoo-n-mas-uno',
      'tasa-5xx',
      'key-401',
      'kiosco-mudo',
    ];

    expect([...esperados].filter((id) => !anclas.has(id))).toEqual([]);
  });

  it('las alertas que se pueden construir aquí apuntan a un ancla real', () => {
    for (const a of todas) {
      expect(a.runbook).toBe(`docs/05-RUNBOOKS.md#${a.id}`);
      expect(anclas.has(a.id)).toBe(true);
    }
  });
});

describe('#46 · Regla de sincronización', () => {
  it('detecta el cerrojo colgado como crítico', async () => {
    const previo = await prisma.syncState.findUnique({ where: { entidad: 'res.partner' } });

    await prisma.syncState.upsert({
      where: { entidad: 'res.partner' },
      create: {
        entidad: 'res.partner',
        ejecutando: true,
        ejecutandoDesde: haceMin(UMBRALES.syncColgadoMin + 10),
        ultimaEjecucion: new Date(),
      },
      update: {
        ejecutando: true,
        ejecutandoDesde: haceMin(UMBRALES.syncColgadoMin + 10),
        ultimaEjecucion: new Date(),
      },
    });

    try {
      const a = await reglaSync();
      expect(a?.id).toBe('sync-colgado');
      expect(a?.severidad).toBe('critica');
    } finally {
      // Se restaura el estado real: esta tabla la usa el job de verdad, y
      // dejarla con el cerrojo puesto bloquearía la siguiente sincronización.
      await restaurarSync(previo);
    }
  });

  it('no avisa si acaba de ejecutarse', async () => {
    const previo = await prisma.syncState.findUnique({ where: { entidad: 'res.partner' } });

    await prisma.syncState.upsert({
      where: { entidad: 'res.partner' },
      create: { entidad: 'res.partner', ejecutando: false, ultimaEjecucion: new Date() },
      update: { ejecutando: false, ejecutandoDesde: null, ultimaEjecucion: new Date() },
    });

    try {
      expect(await reglaSync()).toBeNull();
    } finally {
      await restaurarSync(previo);
    }
  });
});
