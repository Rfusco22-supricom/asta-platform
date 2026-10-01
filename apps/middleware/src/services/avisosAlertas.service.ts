import { prisma } from '../config/prisma.js';
import type { Alerta } from './alerts.service.js';

/**
 * Qué alertas se avisan en cada pasada del comprobador (#46).
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 *
 * El cron corre cada pocos minutos. Sin memoria, una alerta que dura —el sync
 * lleva horas atrasado— se mandaría en cada pasada, y un buzón que repite lo
 * mismo cada cinco minutos acaba filtrado a la papelera. El día de la alerta
 * nueva tampoco la lee nadie. Una alerta silenciada es peor que ninguna, porque
 * da sensación de cobertura.
 *
 * ── Cuándo se avisa ──────────────────────────────────────────────────────────
 *
 *   nueva          una alerta que no estaba activa
 *   cambiada       cambia de gravedad (un aviso que pasa a crítica, o al revés)
 *   recordatorio   sigue activa y hace `recordatorioMs` del último aviso
 *   resuelta       estaba activa y ya no sale
 *
 * El DETALLE no cuenta como cambio: «70,6 h sin sincronizar» crece en cada
 * pasada, y avisar por eso sería volver al problema de arriba.
 *
 * ── La prudencia que importa ─────────────────────────────────────────────────
 *
 * Si alguna regla no se pudo evaluar —MySQL caído, una consulta que falla—, que
 * una alerta no salga NO significa que se haya resuelto. En esa pasada no se da
 * nada por resuelto.
 */

export type TipoAviso = 'nueva' | 'cambiada' | 'recordatorio' | 'resuelta';

export interface Aviso {
  tipo: TipoAviso;
  id: string;
  severidad: string;
  titulo: string;
  /** Vacío en las resueltas: ya no hay números que dar. */
  detalle: string;
  runbook: string;
  /** Desde cuándo está activa. */
  desde: Date;
}

export interface EstadoAlerta {
  id: string;
  severity: string;
  title: string;
  active: boolean;
  since: Date;
  lastNotifiedAt: Date;
  resolvedAt: Date | null;
}

const RUNBOOKS = 'docs/05-RUNBOOKS.md';

/**
 * Decide qué avisar y cómo queda el estado. Pura: no lee ni escribe nada, para
 * poder probar cada caso sin base ni reloj.
 */
export function decidirAvisos(
  activas: Alerta[],
  estados: EstadoAlerta[],
  opciones: { ahora: Date; recordatorioMs: number; hayReglasSinEvaluar: boolean },
): { avisos: Aviso[]; escribir: EstadoAlerta[] } {
  const { ahora, recordatorioMs, hayReglasSinEvaluar } = opciones;
  const previo = new Map(estados.map((e) => [e.id, e]));
  const avisos: Aviso[] = [];
  const escribir: EstadoAlerta[] = [];

  for (const a of activas) {
    const e = previo.get(a.id);
    const aviso = (tipo: TipoAviso, desde: Date): Aviso => ({
      tipo,
      id: a.id,
      severidad: a.severidad,
      titulo: a.titulo,
      detalle: a.detalle,
      runbook: a.runbook,
      desde,
    });

    if (!e || !e.active) {
      avisos.push(aviso('nueva', ahora));
      escribir.push({ id: a.id, severity: a.severidad, title: a.titulo, active: true, since: ahora, lastNotifiedAt: ahora, resolvedAt: null });
    } else if (e.severity !== a.severidad) {
      avisos.push(aviso('cambiada', e.since));
      escribir.push({ ...e, severity: a.severidad, title: a.titulo, lastNotifiedAt: ahora });
    } else if (ahora.getTime() - e.lastNotifiedAt.getTime() >= recordatorioMs) {
      avisos.push(aviso('recordatorio', e.since));
      escribir.push({ ...e, title: a.titulo, lastNotifiedAt: ahora });
    }
    // Activa, igual y avisada hace poco: nada que decir.
  }

  if (!hayReglasSinEvaluar) {
    const siguen = new Set(activas.map((a) => a.id));
    for (const e of estados) {
      if (!e.active || siguen.has(e.id)) continue;
      avisos.push({ tipo: 'resuelta', id: e.id, severidad: e.severity, titulo: e.title, detalle: '', runbook: `${RUNBOOKS}#${e.id}`, desde: e.since });
      escribir.push({ ...e, active: false, resolvedAt: ahora, lastNotifiedAt: ahora });
    }
  }

  return { avisos, escribir };
}

export async function cargarEstados(): Promise<EstadoAlerta[]> {
  return prisma.alertState.findMany();
}

export async function guardarEstados(estados: EstadoAlerta[]): Promise<void> {
  if (estados.length === 0) return;
  await prisma.$transaction(
    estados.map((e) =>
      prisma.alertState.upsert({
        where: { id: e.id },
        create: { ...e, title: e.title.slice(0, 200) },
        update: { severity: e.severity, title: e.title.slice(0, 200), active: e.active, since: e.since, lastNotifiedAt: e.lastNotifiedAt, resolvedAt: e.resolvedAt },
      }),
    ),
  );
}

/**
 * Todas las activas como «nuevas», para cuando no se puede leer el estado.
 *
 * Sin memoria no se sabe qué se avisó ya. Repetir es molesto; callar una crítica
 * porque no se pudo consultar la tabla sería el fallo que esto existe para
 * evitar.
 */
export function todoComoNuevo(activas: Alerta[], ahora: Date): Aviso[] {
  return activas.map((a) => ({ tipo: 'nueva', id: a.id, severidad: a.severidad, titulo: a.titulo, detalle: a.detalle, runbook: a.runbook, desde: ahora }));
}
