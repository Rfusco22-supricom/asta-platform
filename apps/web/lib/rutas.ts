/**
 * A dónde pertenece cada rol.
 *
 * La regla ya no vive aquí: sale de `navegacion.ts`, que es la primera sección
 * del menú de ese rol. Tenerla escrita aparte fue lo que hizo que un cliente
 * aterrizara en un 403 —se arregló la raíz y el login se quedó con su copia—, y
 * un menú que promete una sección a la que el enrutado no lleva es la misma
 * historia otra vez.
 *
 * Se mantiene el fichero para no tocar los dos sitios que lo importan.
 */
export { destinoPara } from './navegacion';
