import type { Metadata } from 'next';
import { CORREO_APP, PaginaPublica, REVISADA } from '@/components/legal/PaginaPublica';

/**
 * La política de privacidad de la aplicación ASTA para tablets, la que enlazan
 * App Store y Google Play. Dice solo lo que la aplicación hace de verdad: si
 * cambia lo que manda al servidor (`Api.swift`, `Api.kt`, `kiosk.ts`), esto
 * tiene que cambiar con ello, y las respuestas de privacidad de las tiendas
 * (`docs/14-TIENDAS.md`).
 */

export const metadata: Metadata = { title: 'Política de privacidad · ASTA' };

export default function PrivacidadPage() {
  return (
    <PaginaPublica titulo="Política de privacidad">
      <p className="legal-fecha">Última revisión: {REVISADA}</p>
      <p>
        La aplicación <strong>ASTA · Encuentra tu tóner</strong> es de Supricom, distribuidor de la marca ASTA. Se usa en tablets dentro de las tiendas:
        quien la usa escribe el modelo de su impresora y la aplicación le enseña los tóners y tintas que le sirven.
      </p>

      <h2>Lo que no pedimos</h2>
      <p>
        La aplicación no pide nombre, correo, teléfono ni ningún otro dato a quien la usa, y no tiene cuentas ni inicios de sesión. No usa publicidad, no
        sigue a nadie entre aplicaciones o sitios web y no accede a la ubicación, los contactos ni las fotos del dispositivo.
      </p>

      <h2>Lo que la aplicación envía</h2>
      <ul>
        <li>
          <strong>Las búsquedas.</strong> Lo que se escribe en el buscador (el modelo de una impresora), cuántos resultados salieron y qué producto se
          tocó. Se guarda con la tablet que hizo la búsqueda, nunca con una persona, para enseñar los resultados, mejorar las compatibilidades y que la
          tienda y Supricom vean qué se busca.
        </li>
        <li>
          <strong>La vinculación de la tablet.</strong> Al vincularla con el código del panel, la aplicación envía ese código, el tipo de sistema (iOS o
          Android), el modelo de la tablet y la versión de la aplicación. A cambio recibe una credencial que identifica a la tablet y que se guarda en el
          almacén seguro del dispositivo.
        </li>
        <li>
          <strong>El estado de la conexión.</strong> Cada diez minutos la aplicación avisa de que sigue funcionando, para que la tienda sepa si la tablet
          está en línea. Nuestro servidor registra además la dirección IP y la fecha de cada petición, por seguridad.
        </li>
      </ul>

      <h2>La cámara</h2>
      <p>
        La cámara solo se usa, si se elige, para leer el código QR que vincula la tablet. La imagen no se guarda ni se envía a ningún sitio.
      </p>

      <h2>Quién ve estos datos</h2>
      <p>
        La tienda dueña de la tablet ve las búsquedas de sus tablets en el panel de ASTA, y Supricom las de todas. No se venden ni se comparten con
        terceros. Todo viaja cifrado (HTTPS).
      </p>

      <h2>Cuánto se guardan</h2>
      <p>
        Mientras la tablet esté vinculada y el tiempo necesario para las estadísticas del servicio. La tienda puede desvincular una tablet desde su
        panel en cualquier momento, y pedirnos que borremos sus búsquedas.
      </p>

      <h2>Menores</h2>
      <p>La aplicación es una herramienta de tienda y no está dirigida a menores de edad.</p>

      <h2>Contacto</h2>
      <p>
        Para cualquier pregunta sobre estos datos, o para pedir que se borren, escríbenos a <a href={`mailto:${CORREO_APP}`}>{CORREO_APP}</a>.
      </p>
      <p>Si esta política cambia, lo publicaremos aquí con su nueva fecha.</p>
    </PaginaPublica>
  );
}
