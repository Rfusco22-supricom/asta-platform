/**
 * Latencia de Odoo, en memoria (issue #46).
 *
 * ── Por qué una ventana en memoria y no una tabla ────────────────────────────
 *
 * El issue pide alertar cuando el p95 de Odoo pasa de un umbral. Hasta ahora
 * cada RPC se cronometraba y se escribía en el log (#10), pero un log no se
 * consulta: para saber el p95 habría que agregarlo desde fuera, y no hay nada
 * que lo agregue.
 *
 * Guardarlo en MySQL sería una escritura por cada llamada a Odoo —dos por cada
 * carga de cartera— para un dato que solo interesa en agregado y de los últimos
 * minutos. No compensa.
 *
 * Una ventana circular en memoria da el número al instante y no cuesta nada.
 *
 * ── Lo que esto NO es ────────────────────────────────────────────────────────
 *
 * No es un histórico. Se pierde al reiniciar el proceso, y con varias instancias
 * cada una ve la suya. Para "¿cómo iba Odoo el martes?" hace falta otra cosa.
 * Para "¿está Odoo lento AHORA?", que es lo que dispara una alerta, sobra.
 */

import { anotarRpcOdoo } from '../utils/contextoPeticion.js';

/** Cuántas llamadas se recuerdan. 500 son unos minutos de tráfico normal. */
const CAPACIDAD = 500;

const duraciones = new Int32Array(CAPACIDAD);
let escritas = 0;

let fallos = 0;
let totales = 0;

export function registrarRpc(ms: number, ok: boolean): void {
  // El índice da la vuelta: siempre se conservan las últimas CAPACIDAD.
  duraciones[escritas % CAPACIDAD] = ms;
  escritas++;

  totales++;
  if (!ok) fallos++;

  // Además de la ventana global, cuenta el RPC en la petición HTTP que lo
  // disparó, si la hay (`api_request_logs.odoo_calls`, alerta de N+1). Cuenta
  // también los fallidos: una llamada que falla le costó igual a Odoo.
  anotarRpcOdoo();
}

export interface MetricasOdoo {
  /** Llamadas en la ventana. 0 significa "sin datos", no "todo bien". */
  muestras: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  maximo: number | null;
  /** Acumulados desde que arrancó el proceso, no de la ventana. */
  llamadasTotales: number;
  fallosTotales: number;
}

/**
 * Percentil por el método del más cercano por rango.
 *
 * Con 500 muestras la diferencia entre métodos de interpolación es ruido, y
 * este devuelve siempre un valor que ocurrió de verdad — más fácil de creer
 * cuando alguien contrasta la alerta con el log.
 */
function percentil(ordenadas: number[], p: number): number {
  if (ordenadas.length === 0) return 0;
  const i = Math.ceil((p / 100) * ordenadas.length) - 1;
  return ordenadas[Math.min(Math.max(i, 0), ordenadas.length - 1)];
}

export function metricasOdoo(): MetricasOdoo {
  const n = Math.min(escritas, CAPACIDAD);

  if (n === 0) {
    return {
      muestras: 0,
      p50: null,
      p95: null,
      p99: null,
      maximo: null,
      llamadasTotales: totales,
      fallosTotales: fallos,
    };
  }

  const ventana = Array.from(duraciones.subarray(0, n)).sort((a, b) => a - b);

  return {
    muestras: n,
    p50: percentil(ventana, 50),
    p95: percentil(ventana, 95),
    p99: percentil(ventana, 99),
    maximo: ventana[ventana.length - 1],
    llamadasTotales: totales,
    fallosTotales: fallos,
  };
}

/** Solo para tests: vacía la ventana. */
export function reiniciarMetricas(): void {
  escritas = 0;
  fallos = 0;
  totales = 0;
  duraciones.fill(0);
}
