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

/** Para los tests. */
export function vaciarCachePantallas(): void {
  cache.vaciar();
}
