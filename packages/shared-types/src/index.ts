/**
 * @asta/shared-types — contrato de la API de ASTA.
 *
 * Es la única superficie que comparten los dos tracks de trabajo. Por eso tiene
 * regla propia (ver docs/03-REPARTO.md §4):
 *
 *   1. Se define en conjunto, no unilateralmente.
 *   2. Cambiarlo es un PR con revisión del otro track. Siempre.
 *   3. Añadir un campo opcional no rompe a nadie. Quitar o renombrar uno sí:
 *      eso se avisa ANTES de abrir el PR.
 *
 * Los schemas de zod son la fuente de verdad y los tipos se infieren de ellos.
 * Una sola definición sirve para validar en runtime y para tipar en compilación,
 * así que no pueden divergir. La alternativa —interfaces a mano por un lado y
 * validadores por otro— se desincroniza a la primera prisa.
 */

export * from './common.js';
export * from './identity.js';
export * from './partners.js';
export * from './invoicing.js';
export * from './catalog.js';
export * from './recommender.js';
export * from './apiKeys.js';
export * from './permissions.js';
export * from './sessions.js';
