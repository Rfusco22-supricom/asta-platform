'use client';

import { useState } from 'react';
import { guardarDemo, type Demo } from '@/app/aplicacion/api';
import { empezarCarga } from '@/components/CargaGlobal';

/**
 * «Mostrar la aplicación ASTA»: el vendedor, de visita en un cliente, abre la
 * aplicación en su teléfono para enseñársela, sin activar una tablet.
 *
 * Pide al middleware una demostración (`/api/aplicacion-demo`: un token firmado
 * que vale hasta el final del día, con las existencias de su sede), la guarda
 * donde la busca la aplicación web (`guardarDemo`) y la abre en esta misma
 * pestaña. «Terminar», abajo en la aplicación, lo devuelve al panel.
 */
export function MostrarAplicacion({ className = 'btn btn-inline' }: { className?: string }) {
  const [abriendo, setAbriendo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const abrir = async () => {
    setAbriendo(true);
    setFallo(null);
    try {
      const r = await fetch('/api/aplicacion-demo', { method: 'POST', cache: 'no-store' });
      const cuerpo = (await r.json().catch(() => null)) as { data?: Demo } | null;
      if (!r.ok || !cuerpo?.data) throw new Error();
      guardarDemo(cuerpo.data);
      empezarCarga();
      window.location.href = '/aplicacion/inicio';
    } catch {
      setFallo('No se pudo abrir ahora. Inténtalo otra vez.');
      setAbriendo(false);
    }
  };

  return (
    <span className="mostrar-aplicacion">
      <button type="button" className={className} onClick={abrir} disabled={abriendo} title="Abre la aplicación ASTA en este dispositivo para enseñársela a un cliente">
        {abriendo ? 'Abriendo…' : 'Mostrar la aplicación ASTA'}
      </button>
      {fallo && (
        <small className="mostrar-aplicacion-fallo" role="alert">
          {fallo}
        </small>
      )}
    </span>
  );
}
