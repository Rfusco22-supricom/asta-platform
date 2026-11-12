import { redirect } from 'next/navigation';

/**
 * `/aplicacion` es la dirección que se escribe o que lleva el QR del panel; la
 * aplicación vive en `/aplicacion/inicio` (ver allí por qué).
 */
export default function AplicacionRedirige() {
  redirect('/aplicacion/inicio');
}
