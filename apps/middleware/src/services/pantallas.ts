import { CacheConRefresco } from '../utils/cacheConRefresco.js';

/**
 * Lo que las pantallas del panel leen de Odoo, guardado un rato.
 *
 * Medido el 9-oct-2026: cada sección tardaba de uno a tres segundos, y volver a
 * ella a los diez segundos repetía la espera. Con `CacheConRefresco`:
 *
 *   · menos de UN minuto: se contesta con lo guardado;
 *   · hasta DIEZ: se contesta con lo guardado al momento y se renueva por
 *     detrás, así que la siguiente vez ya es lo nuevo;
 *   · más: se espera a Odoo.
 *
 * Solo lo que sale de Odoo. Lo que el propio panel escribe —notas, marcas de
 * Impulsa, cuentas y accesos— se lee siempre en vivo, para que lo que alguien
 * acaba de guardar se vea al volver.
 *
 * La CLAVE lleva todo lo que cambia la respuesta y empieza por quién la ve:
 * `admin:…` para las de administración, `vendedor:<odooUserId>:…` para las de
 * una cartera, `cliente:<partnerId>:…` para la ficha, que ya pasó por
 * `autorizar` y dice lo mismo a cualquiera que pueda abrirla.
 */
const cache = new CacheConRefresco<unknown>(60_000, 10 * 60_000, 2_000);

export function dePantalla<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
  return cache.obtener(clave, cargar) as Promise<T>;
}

/**
 * Mantiene calientes las pantallas que se usaron en las últimas `HORAS_USADAS`
 * horas: las que tienen más de seis minutos se vuelven a leer por detrás, y con
 * una pasada cada cuatro nunca llegan a los diez: quien vuelve no espera a Odoo. Lo corre el servidor cada pocos minutos
 * (`server.ts`). Dos a la vez y como mucho `MAXIMO_POR_PASADA`, para no
 * cargar a Odoo; las más recientes primero.
 */
export const HORAS_USADAS = 8;
export const MAXIMO_POR_PASADA = 150;

/** Venezuela, UTC−4 todo el año. */
const DESFASE_CARACAS_MS = -4 * 3600_000;
const diaEnCaracas = (ms: number) => Math.floor((ms + DESFASE_CARACAS_MS) / 86_400_000);

/**
 * Solo lo pedido HOY (en Caracas). Una lectura guardada repite la de su
 * petición, y algunas llevan la fecha de ese momento (el programa del
 * trimestre, la actividad de la cartera): renovarla al día siguiente daría
 * cifras de ayer. La primera visita del día lee de Odoo.
 */
export const mismoDia = (usado: number, ahora: number) => diaEnCaracas(usado) === diaEnCaracas(ahora);

export function renovarPantallas(): Promise<{ renovadas: number; fallidas: number }> {
  return cache.renovarUsadas({
    usadasEnMs: HORAS_USADAS * 3600_000,
    masViejasDeMs: 6 * 60_000,
    maximo: MAXIMO_POR_PASADA,
    enParalelo: 2,
    vigente: mismoDia,
  });
}

/** Para cuando el panel acaba de cambiar lo que guarda esa clave. */
export function olvidarPantalla(clave: string): void {
  cache.olvidar(clave);
}

/** Para los tests. */
export function vaciarCachePantallas(): void {
  cache.vaciar();
}
