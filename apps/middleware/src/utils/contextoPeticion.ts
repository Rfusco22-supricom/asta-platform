import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de una petición HTTP, visible desde cualquier punto de su ejecución.
 *
 * Existe para contar cuántos RPC a Odoo cuesta cada petición de la API pública
 * (`api_request_logs.odoo_calls`), que es lo que lee la alerta de N+1 de #46.
 *
 * El cliente de Odoo no sabe qué petición HTTP lo está llamando, y no debe
 * saberlo: pasarle un contador por parámetro obligaría a cambiar la firma de cada
 * servicio que habla con Odoo. `AsyncLocalStorage` resuelve eso sin tocar nada:
 * el contexto se abre al empezar la petición y sigue a todas sus continuaciones
 * asíncronas, así que `registrarRpc` puede anotar la llamada sin saber de dónde
 * viene.
 *
 * Fuera de una petición —el job de sync, un script— no hay contexto y anotar no
 * hace nada.
 */
export interface ContextoPeticion {
  odooCalls: number;
}

const almacen = new AsyncLocalStorage<ContextoPeticion>();

export function nuevoContexto(): ContextoPeticion {
  return { odooCalls: 0 };
}

/**
 * Ejecuta `fn` dentro de `contexto`.
 *
 * El contexto se crea aparte, con `nuevoContexto()`, para que quien lo abre pueda
 * guardarse la referencia y leerla después sin depender del almacén.
 */
export function ejecutarEnContexto(contexto: ContextoPeticion, fn: () => void): void {
  almacen.run(contexto, fn);
}

/** Anota un RPC a Odoo en la petición en curso, si la hay. */
export function anotarRpcOdoo(): void {
  const contexto = almacen.getStore();
  if (contexto) contexto.odooCalls++;
}
