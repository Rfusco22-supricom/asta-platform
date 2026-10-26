'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { CodigoTablet as Codigo, EstadoCodigoTablet } from '@asta/shared-types';

/**
 * El código para vincular una tablet, tal como se enseña en el panel: los 6
 * dígitos grandes, su QR, lo que le queda de vida y los pasos.
 *
 * Mientras está a la vista pregunta si ya se usó (`urlEstado`) y, en cuanto la
 * tablet entra, lo dice: quien instala la tablet tiene el panel al lado.
 *
 * El QR lleva `asta-tablet:<código>`: la app solo acepta un QR con esa forma,
 * así que otro QR que pase por delante de la cámara no se toma por un código.
 */

/** Cada cuánto se pregunta si la tablet ya entró. */
const CADA_MS = 3_000;

/** «482 913», o «1234 5678 9012» el de los revisores: se lee y se dicta mejor. */
export function agrupar(codigo: string): string {
  return (codigo.match(codigo.length === 12 ? /\d{4}/g : /\d{3}/g) ?? [codigo]).join(' ');
}

function quedan(expira: string | null): string | null {
  if (!expira) return null;
  const s = Math.max(0, Math.round((new Date(expira).getTime() - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CodigoTablet({
  codigo,
  urlEstado,
  onConectada,
  onCerrar,
}: {
  codigo: Codigo;
  /** De dónde preguntar si ya se usó. Sin ella (el de los revisores), no se pregunta. */
  urlEstado?: string;
  onConectada?: (tablet: { id: string; nombre: string }) => void;
  onCerrar: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [reloj, setReloj] = useState(() => quedan(codigo.expiraEn));
  const [estado, setEstado] = useState<EstadoCodigoTablet | null>(null);

  // El QR se dibuja en el navegador: el código no sale de esta pantalla.
  // Oscuro sobre blanco siempre, también en el tema oscuro: es lo que leen bien las cámaras.
  useEffect(() => {
    let vigente = true;
    QRCode.toString(`asta-tablet:${codigo.codigo}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f2236', light: '#ffffff' } })
      .then((svg) => vigente && setQr(svg))
      .catch(() => vigente && setQr(null));
    return () => {
      vigente = false;
    };
  }, [codigo.codigo]);

  useEffect(() => {
    if (!codigo.expiraEn) return;
    const t = setInterval(() => setReloj(quedan(codigo.expiraEn)), 1000);
    return () => clearInterval(t);
  }, [codigo.expiraEn]);

  useEffect(() => {
    if (!urlEstado) return;
    let vigente = true;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await fetch(urlEstado, { cache: 'no-store' }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { data?: EstadoCodigoTablet } | null) : null;
      if (!vigente || !body?.data) return;
      setEstado(body.data);
      if (body.data.estado !== 'PENDIENTE') clearInterval(t);
      if (body.data.estado === 'USADO' && body.data.tablet) onConectada?.(body.data.tablet);
    }, CADA_MS);
    return () => {
      vigente = false;
      clearInterval(t);
    };
    // `onConectada` cambia en cada render del padre: no debe reiniciar el sondeo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEstado]);

  const conectada = estado?.estado === 'USADO';
  const caducado = estado?.estado === 'CADUCADO' || reloj === '0:00';

  return (
    <section className="kio-token" role="alertdialog" aria-labelledby="kio-codigo-titulo" aria-live="polite">
      {conectada ? (
        <>
          <h2 id="kio-codigo-titulo" className="kio-conectada">✓ Tablet conectada{estado.tablet ? `: ${estado.tablet.nombre}` : ''}</h2>
          <p className="kio-token-aviso">Ya está lista: en la tablet aparece la pantalla de inicio de la aplicación ASTA.</p>
        </>
      ) : (
        <>
          <h2 id="kio-codigo-titulo">{urlEstado ? 'Código para vincular la tablet' : 'Código para los revisores de Apple y Google'}</h2>
          <div className="kio-activar">
            {/* SVG generado aquí mismo por `qrcode` a partir del código: no lleva nada de fuera. */}
            {qr ? (
              <div className={`kio-qr${caducado ? ' caducado' : ''}`} role="img" aria-label="Código QR para vincular la tablet" dangerouslySetInnerHTML={{ __html: qr }} />
            ) : (
              <div className="kio-qr kio-qr-vacio" aria-hidden="true" />
            )}
            <div className="kio-activar-texto">
              <code className={`kio-codigo-grande${caducado ? ' caducado' : ''}`} aria-label={`Código ${codigo.codigo.split('').join(' ')}`}>
                {agrupar(codigo.codigo)}
              </code>
              {caducado ? (
                <p className="kio-mensaje error">Este código caducó. Cierra y pide otro.</p>
              ) : urlEstado ? (
                <>
                  <p className="kio-token-aviso">
                    Caduca en <strong className="kio-reloj">{reloj}</strong> y sirve para una sola tablet.
                  </p>
                  <ol className="kio-pasos">
                    <li>En la tablet, abre la aplicación ASTA: la primera vez pide un código.</li>
                    <li>
                      Escribe estos 6 dígitos, o pulsa <strong>Escanear el código</strong> y apunta la cámara a este QR.
                    </li>
                    <li>La tablet entra sola, y aquí verás «Tablet conectada».</li>
                  </ol>
                </>
              ) : (
                <p className="kio-token-aviso">
                  <strong>Cópialo ahora: no se vuelve a mostrar.</strong> No caduca y sirve para varias tablets, que verán solo
                  compatibilidades. Ponlo en «App access» (Google Play) y en las notas para la revisión (App Store). Revócalo cuando ya no haga falta.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      <div className="kio-token-pie">
        <button type="button" className="btn btn-inline" onClick={onCerrar}>
          {conectada ? 'Listo' : 'Cerrar'}
        </button>
      </div>
    </section>
  );
}
