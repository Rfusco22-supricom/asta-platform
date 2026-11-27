import type { Metadata } from 'next';
import Link from 'next/link';
import { CORREO_APP, PaginaPublica } from '@/components/legal/PaginaPublica';

/**
 * El soporte de la aplicación ASTA para tablets: la página que enlazan App
 * Store y Google Play. Cómo se vincula una tablet y lo que más se pregunta.
 */

export const metadata: Metadata = { title: 'Soporte · ASTA' };

export default function SoportePage() {
  return (
    <PaginaPublica titulo="Soporte de la aplicación ASTA">
      <p>
        <strong>ASTA · Encuentra tu tóner</strong> es la aplicación de las tablets de las tiendas que venden ASTA: el cliente escribe el modelo de su
        impresora y ve qué tóner o tinta le sirve.
      </p>

      <h2>Vincular una tablet</h2>
      <ol>
        <li>Instala la aplicación en la tablet y ábrela: pide un código.</li>
        <li>
          En el panel de ASTA, entra en <strong>Mis tablets</strong> y pulsa <strong>Registrar una tablet</strong>.
        </li>
        <li>Escribe en la tablet el código de 6 dígitos, o lee el código QR con la cámara. El código vale 10 minutos y una sola vez.</li>
      </ol>
      <p>
        ¿Todavía no tienes acceso al panel? Pídeselo a tu vendedor de Supricom. Si ya lo tienes, <Link href="/login">entra aquí</Link>.
      </p>

      <h2>Preguntas frecuentes</h2>
      <h3>No encuentra mi impresora</h3>
      <p>Prueba solo con las letras y números del modelo, como aparecen en el frente o en la tapa: «M404», «L3250». Cada búsqueda sin resultado nos llega para revisarla.</p>
      <h3>La tablet dice que no hay conexión</h3>
      <p>Comprueba el wifi de la tablet. La aplicación lo vuelve a intentar sola y enseña lo último que cargó mientras tanto.</p>
      <h3>La tablet me pide otra vez el código</h3>
      <p>La tablet se desvinculó desde el panel. Genera un código nuevo en «Mis tablets» y vuelve a vincularla.</p>

      <h2>Contacto</h2>
      <p>
        Escríbenos a <a href={`mailto:${CORREO_APP}`}>{CORREO_APP}</a>. Lo que hacemos con los datos de la aplicación está en la{' '}
        <Link href="/privacidad">política de privacidad</Link>.
      </p>
    </PaginaPublica>
  );
}
