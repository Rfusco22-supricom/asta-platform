import { Aplicacion } from '../Aplicacion';

/**
 * `/aplicacion/inicio`: la aplicación ASTA, en el navegador. Pública: no pide
 * la sesión del panel. La tablet (o el teléfono) se activa con el código de 6
 * dígitos que se saca en el panel (Tablets → «Añadir tablet»), como la nativa.
 *
 * Vive en una carpeta (`/aplicacion/…`) y no en `/aplicacion` a secas: el
 * alcance de la aplicación instalada (`scope` del manifiesto) tiene que ser un
 * directorio. Con `/aplicacion` sin barra, Chrome en Android la abría con su
 * barra de «Se ejecuta en Chrome» encima, como si fuera una página de fuera.
 */
export default function AplicacionPage() {
  return <Aplicacion />;
}
