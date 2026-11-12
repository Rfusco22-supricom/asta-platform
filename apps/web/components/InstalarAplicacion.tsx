'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * «Instala la aplicación ASTA en tu tablet»: de dónde sacan la aplicación los
 * clientes (y Supricom para sus tiendas) mientras no esté en App Store ni en
 * Google Play. Es la versión web (`app/aplicacion`): no hay archivo que
 * descargar, se abre la dirección en el navegador de la tablet y se añade a la
 * pantalla de inicio.
 *
 * El QR lleva la dirección: se escanea con la cámara de la tablet y se abre sin
 * escribir nada. Cuando haya enlaces de las tiendas (`APP_IOS_URL`,
 * `APP_ANDROID_URL`), quien lo usa deja de pintarlo y enseña esos.
 */
export function InstalarAplicacion() {
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState<string | null>(null);

  // La dirección del propio panel: la misma en local, en pruebas y en producción.
  useEffect(() => setUrl(`${window.location.origin}/aplicacion`), []);

  // Oscuro sobre blanco siempre, también en el tema oscuro: es lo que leen bien las cámaras.
  useEffect(() => {
    if (!url) return;
    let vigente = true;
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f2236', light: '#ffffff' } })
      .then((svg) => vigente && setQr(svg))
      .catch(() => vigente && setQr(null));
    return () => {
      vigente = false;
    };
  }, [url]);

  const legible = url.replace(/^https?:\/\//, '');

  return (
    <section className="kio-alta instalar-app" aria-labelledby="instalar-app-titulo">
      <div className="instalar-app-fila">
        {qr ? (
          <div className="kio-qr instalar-app-qr" role="img" aria-label="Código QR con la dirección de la aplicación ASTA" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <div className="kio-qr kio-qr-vacio instalar-app-qr" aria-hidden="true" />
        )}
        <div className="instalar-app-texto">
          <div className="kio-alta-cabecera">
            <h2 id="instalar-app-titulo">Instala la aplicación ASTA en tu tablet</h2>
            <p>No hay que descargar nada: se abre en el navegador de la tablet y se añade a su pantalla de inicio. Queda con su icono y se abre a pantalla completa, como cualquier aplicación.</p>
          </div>
          <ol className="instalar-app-pasos">
            <li>
              Escanea este QR con la cámara de la tablet, o escribe en su navegador <strong className="instalar-app-url">{legible || '…/aplicacion'}</strong>
            </li>
            <li>
              <b>iPad:</b> en Safari, toca <b>Compartir</b> (el cuadrado con la flecha) → <b>Añadir a pantalla de inicio</b>.
              <br />
              <b>Android:</b> en Chrome, toca el menú <b>⋮</b> → <b>Instalar aplicación</b>.
            </li>
            <li>Ábrela desde el icono de ASTA y escribe el código de 6 dígitos que sale aquí abajo al pulsar «Añadir tablet».</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
