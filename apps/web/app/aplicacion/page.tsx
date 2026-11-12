import { Aplicacion } from './Aplicacion';

/**
 * `/aplicacion`: la aplicación ASTA para tablets, en el navegador. Pública: no
 * pide la sesión del panel. La tablet se activa con el código de 6 dígitos que
 * se saca en el panel (Tablets → «Añadir tablet»), como la nativa.
 */
export default function AplicacionPage() {
  return <Aplicacion />;
}
