import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import type { Alerta } from '../services/alerts.service.js';
import { decidirAvisos, todoComoNuevo, type EstadoAlerta } from '../services/avisosAlertas.service.js';
import { plantillaAlertas } from '../services/correo.service.js';

/**
 * #46 · Qué se avisa en cada pasada del comprobador.
 *
 * La decisión es pura y se prueba con un reloj inventado. Lo que se vigila es lo
 * que hace que el canal se siga leyendo: una alerta que dura no se repite cada
 * cinco minutos, y lo que no se pudo comprobar no se da por resuelto.
 */

const H = 3600_000;
const T0 = new Date('2026-10-01T08:00:00Z');
const en = (horas: number) => new Date(T0.getTime() + horas * H);
const opciones = (ahora: Date, hayReglasSinEvaluar = false) => ({ ahora, recordatorioMs: 4 * H, hayReglasSinEvaluar });

const alerta = (id: string, severidad: 'critica' | 'aviso' = 'critica', detalle = 'detalle'): Alerta => ({
  id,
  severidad,
  titulo: `Título ${id}`,
  detalle,
  runbook: `docs/05-RUNBOOKS.md#${id}`,
});

/** Una pasada: decide y aplica lo que hay que escribir, como haría el comprobador. */
function pasada(estados: EstadoAlerta[], activas: Alerta[], ahora: Date, hayReglasSinEvaluar = false) {
  const { avisos, escribir } = decidirAvisos(activas, estados, opciones(ahora, hayReglasSinEvaluar));
  const siguiente = new Map(estados.map((e) => [e.id, e]));
  for (const e of escribir) siguiente.set(e.id, e);
  return { avisos, estados: [...siguiente.values()] };
}

describe('#46 · Cuándo se avisa', () => {
  it('una alerta nueva se avisa una vez', () => {
    const r = pasada([], [alerta('sync-atrasado')], T0);
    expect(r.avisos.map((a) => [a.tipo, a.id])).toEqual([['nueva', 'sync-atrasado']]);
  });

  it('la misma alerta en la pasada siguiente NO se repite, aunque cambien los números', () => {
    const p1 = pasada([], [alerta('sync-atrasado', 'critica', '6,1 h sin sincronizar')], T0);
    const p2 = pasada(p1.estados, [alerta('sync-atrasado', 'critica', '6,2 h sin sincronizar')], en(0.1));
    expect(p2.avisos).toEqual([]);
  });

  it('si sigue, se recuerda cada 4 horas: ni antes ni nunca', () => {
    let e = pasada([], [alerta('sync-atrasado')], T0).estados;
    for (const h of [1, 2, 3, 3.9]) {
      const r = pasada(e, [alerta('sync-atrasado')], en(h));
      expect(r.avisos, `a las ${h} h`).toEqual([]);
      e = r.estados;
    }
    const r4 = pasada(e, [alerta('sync-atrasado')], en(4));
    expect(r4.avisos.map((a) => a.tipo)).toEqual(['recordatorio']);
    // El recordatorio dice desde cuándo está activa, no desde el último aviso.
    expect(r4.avisos[0].desde).toEqual(T0);
    // Y el siguiente, cuatro horas después de ESTE.
    expect(pasada(r4.estados, [alerta('sync-atrasado')], en(7)).avisos).toEqual([]);
    expect(pasada(r4.estados, [alerta('sync-atrasado')], en(8)).avisos.map((a) => a.tipo)).toEqual(['recordatorio']);
  });

  it('un aviso que pasa a crítica se avisa en el acto', () => {
    const p1 = pasada([], [alerta('latencia-odoo', 'aviso')], T0);
    const p2 = pasada(p1.estados, [alerta('latencia-odoo', 'critica')], en(0.1));
    expect(p2.avisos.map((a) => [a.tipo, a.severidad])).toEqual([['cambiada', 'critica']]);
  });

  it('cuando deja de salir, se avisa que se resolvió, una vez', () => {
    const p1 = pasada([], [alerta('sync-atrasado'), alerta('tasa-5xx', 'aviso')], T0);
    const p2 = pasada(p1.estados, [alerta('tasa-5xx', 'aviso')], en(1));
    expect(p2.avisos.map((a) => [a.tipo, a.id])).toEqual([['resuelta', 'sync-atrasado']]);
    expect(pasada(p2.estados, [alerta('tasa-5xx', 'aviso')], en(2)).avisos).toEqual([]);
  });

  it('si vuelve después de resuelta, es nueva otra vez', () => {
    const p1 = pasada([], [alerta('sync-atrasado')], T0);
    const p2 = pasada(p1.estados, [], en(1));
    const p3 = pasada(p2.estados, [alerta('sync-atrasado')], en(2));
    expect(p3.avisos.map((a) => a.tipo)).toEqual(['nueva']);
    expect(p3.avisos[0].desde).toEqual(en(2));
  });
});

describe('#46 · La prudencia', () => {
  it('si alguna regla no se pudo evaluar, nada se da por resuelto', () => {
    // MySQL caído: las reglas de base fallan y su alerta «desaparece». No se
    // arregló: no se pudo mirar.
    const p1 = pasada([], [alerta('sync-atrasado')], T0);
    const p2 = pasada(p1.estados, [], en(1), true);
    expect(p2.avisos).toEqual([]);
    expect(p2.estados.find((e) => e.id === 'sync-atrasado')?.active).toBe(true);
  });

  it('aun así, lo que sí sale se sigue avisando', () => {
    const r = pasada([], [alerta('middleware-caido')], T0, true);
    expect(r.avisos.map((a) => a.tipo)).toEqual(['nueva']);
  });

  it('sin poder leer qué se avisó, se avisa de todo como nuevo', () => {
    expect(todoComoNuevo([alerta('a'), alerta('b', 'aviso')], T0).map((a) => [a.tipo, a.id])).toEqual([
      ['nueva', 'a'],
      ['nueva', 'b'],
    ]);
  });
});

describe('#46 · El correo', () => {
  const aviso = (tipo: 'nueva' | 'resuelta', severidad: string, titulo = 'Algo') => ({
    tipo,
    severidad,
    titulo,
    detalle: tipo === 'resuelta' ? '' : 'Los números',
    enlace: 'https://ejemplo/docs/05-RUNBOOKS.md#algo',
    desde: T0,
  });

  it('el asunto dice lo grave primero: es lo único que se lee en la bandeja', () => {
    const c = plantillaAlertas('ops@ejemplo', [aviso('nueva', 'critica'), aviso('nueva', 'aviso'), aviso('resuelta', 'critica')]);
    expect(c.asunto).toBe('[ASTA] 🔴 1 crítica · 1 aviso · 1 resuelta');
    expect(plantillaAlertas('ops@ejemplo', [aviso('resuelta', 'critica')]).asunto).toBe('[ASTA] ✅ 1 resuelta');
  });

  it('cada aviso lleva el enlace al runbook, y el título va escapado en el HTML', () => {
    const c = plantillaAlertas('ops@ejemplo', [aviso('nueva', 'critica', '<b>raro</b>')]);
    expect(c.texto).toContain('https://ejemplo/docs/05-RUNBOOKS.md#algo');
    expect(c.html).toContain('&lt;b&gt;raro&lt;/b&gt;');
    expect(c.html).not.toContain('<b>raro</b>');
  });
});

describe('#46 · La memoria, contra MySQL', async () => {
  const { prisma } = await import('../config/prisma.js');
  const { cargarEstados, guardarEstados } = await import('../services/avisosAlertas.service.js');
  const PREFIJO = 'zz-test-46-';
  const limpiar = () => prisma.alertState.deleteMany({ where: { id: { startsWith: PREFIJO } } });

  beforeEach(limpiar);
  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  it('lo que se guarda en una pasada es lo que se lee en la siguiente', async () => {
    const p1 = decidirAvisos([alerta(`${PREFIJO}a`)], [], opciones(T0));
    await guardarEstados(p1.escribir);

    const leidos = (await cargarEstados()).filter((e) => e.id.startsWith(PREFIJO));
    expect(leidos).toHaveLength(1);
    expect(decidirAvisos([alerta(`${PREFIJO}a`)], leidos, opciones(en(1))).avisos).toEqual([]);

    const resuelta = decidirAvisos([], leidos, opciones(en(1)));
    await guardarEstados(resuelta.escribir);
    expect((await cargarEstados()).find((e) => e.id === `${PREFIJO}a`)).toMatchObject({ active: false, resolvedAt: en(1) });
  });
});
