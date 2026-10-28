'use client';

import { useEffect, useRef, useState } from 'react';
import type { EstadoAlerta } from '@asta/shared-types';
import type { ResumenAlerta } from './DetalleAlertas';

/**
 * Las alertas en el Inicio del administrador: una franja arriba del todo con
 * una tarjeta por alerta, en verde, ámbar o rojo, y el detalle en una ventana al
 * pulsarla. Antes eran una sección del menú; así son lo primero que se ve.
 *
 * El detalle llega ya pintado desde el servidor (`detalles`): aquí solo se
 * decide cuál se enseña.
 */

const NOMBRE_ESTADO: Record<EstadoAlerta, string> = {
  ok: 'En orden',
  advertencia: 'Advertencia',
  prioritaria: 'Prioritaria',
  pronto: 'Aún pronto',
};

/** Un visto bueno, una exclamación, dos, o un reloj mientras es pronto. */
function IconoEstado({ estado }: { estado: EstadoAlerta }) {
  return (
    <span className="alerta-icono" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {estado === 'ok' && <path d="m6.5 12.5 3.5 3.5 7.5-8" />}
        {estado === 'advertencia' && <path d="M12 6.5v7M12 17.5h.01" />}
        {estado === 'prioritaria' && <path d="M9 6.5v7M9 17.5h.01M15 6.5v7M15 17.5h.01" />}
        {estado === 'pronto' && <path d="M12 7v5l3 2" />}
      </svg>
    </span>
  );
}

export function BarraAlertas({ resumen, detalles }: { resumen: ResumenAlerta[]; detalles: Record<ResumenAlerta['id'], React.ReactNode> }) {
  const [abierta, setAbierta] = useState<ResumenAlerta['id'] | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const encendidas = resumen.filter((r) => r.estado === 'advertencia' || r.estado === 'prioritaria').length;

  useEffect(() => {
    const d = dialogo.current;
    if (abierta && d && !d.open) d.showModal();
  }, [abierta]);

  return (
    <section className="alertas-barra" aria-labelledby="alertas-barra-titulo">
      <div className="alertas-barra-cabeza">
        <h2 id="alertas-barra-titulo">Alertas</h2>
        <span className="alertas-barra-nota">
          {encendidas === 0 ? 'Ninguna encendida' : `${encendidas} de ${resumen.length} encendidas`} · solo ASTA, sin Panamá
        </span>
      </div>
      <div className="alertas-resumen">
        {resumen.map((r) => (
          <button key={r.id} type="button" className={`alerta-tarjeta alerta-${r.estado}`} onClick={() => setAbierta(r.id)} aria-haspopup="dialog">
            <IconoEstado estado={r.estado} />
            <span className="alerta-tarjeta-texto">
              <span className="alerta-tarjeta-titulo">{r.titulo}</span>
              <span className="alerta-tarjeta-cifra">{r.cifra}</span>
            </span>
            <span className={`alerta-estado alerta-estado-${r.estado}`}>{NOMBRE_ESTADO[r.estado]}</span>
          </button>
        ))}
      </div>

      {abierta && (
        <dialog
          ref={dialogo}
          className="mes-detalle alerta-modal"
          aria-labelledby={`alerta-${abierta}-titulo`}
          onClose={() => setAbierta(null)}
          // Un clic en el fondo (fuera de la caja) cierra.
          onClick={(e) => e.target === e.currentTarget && dialogo.current?.close()}
        >
          <div className="mes-detalle-caja">
            <button type="button" className="mes-detalle-cerrar alerta-modal-cerrar" onClick={() => dialogo.current?.close()} aria-label="Cerrar">
              ×
            </button>
            {detalles[abierta]}
          </div>
        </dialog>
      )}
    </section>
  );
}
