'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SesionActiva, TipoDispositivo } from '@asta/shared-types';
import { fechaCorta } from '@/lib/formato';

/**
 * Lista de sesiones activas con sus botones de cierre (issue #52).
 *
 * Componente de cliente porque cerrar una sesión es interacción; el listado lo
 * trae el servidor. Tras cada cierre se llama a `router.refresh()` en vez de
 * quitar la fila a mano: si el cierre no llegó a aplicarse, quitarla igualmente
 * diría que un intruso está fuera cuando sigue dentro. En esta pantalla más que
 * en ninguna otra, la lista tiene que ser la de verdad.
 */

const ICONO: Record<TipoDispositivo, string> = {
  movil: '▯',
  tablet: '▭',
  escritorio: '▬',
  desconocido: '?',
};

/**
 * "hace 5 minutos" se lee mejor que una fecha cuando lo que importa es si es
 * reciente.
 *
 * ── El `ahora` ENTRA COMO PARÁMETRO, y eso no es un capricho ─────────────────
 *
 * Antes llamaba a `Date.now()` aquí dentro. Este componente es de cliente, pero
 * se renderiza TAMBIÉN en el servidor, así que el reloj se leía dos veces: una
 * al generar el HTML y otra al hidratar, unos segundos después. Una sesión
 * iniciada hace 59 s salía como "ahora mismo" del servidor y como "hace 1 min"
 * en el navegador, los textos no coincidían y React abortaba la hidratación.
 *
 * Se vio en la consola: "Hydration failed because the server rendered text
 * didn't match". No es cosmético — cuando la hidratación falla, React descarta
 * el HTML del servidor y vuelve a pintar en el cliente.
 *
 * Con un único `ahora` que baja desde el servidor, los dos lados calculan lo
 * mismo. Se refresca en cada `router.refresh()`, que es cuando la lista cambia.
 */
function haceCuanto(iso: string, ahora: number): string {
  const ms = ahora - Date.parse(iso);
  const min = Math.floor(ms / 60_000);

  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;

  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;

  const dias = Math.floor(horas / 24);
  if (dias < 30) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;

  return fechaCorta(iso);
}

export function Sesiones({
  filas,
  otras,
  ahora,
}: {
  filas: SesionActiva[];
  otras: number;
  /** Instante de referencia, fijado por el servidor. Ver `haceCuanto`. */
  ahora: number;
}) {
  const router = useRouter();
  const [cerrando, setCerrando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  async function cerrar(cuerpo: { sesionId?: string; todas?: boolean }, marca: string) {
    setCerrando(marca);
    setFallo(null);
    try {
      const res = await fetch('/api/sesiones', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });

      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        setFallo(body?.error?.message ?? 'No se pudo cerrar la sesión.');
        return;
      }
      router.refresh();
    } catch {
      setFallo('No se pudo contactar con el servidor.');
    } finally {
      setCerrando(null);
    }
  }

  return (
    <section className="panel">
      <div className="sesiones-cabecera">
        <h2>
          {filas.length} {filas.length === 1 ? 'sesión abierta' : 'sesiones abiertas'}
        </h2>

        {/* Solo aparece si hay algo que cerrar. Un botón que no haría nada es
            peor que ninguno: invita a pulsarlo y no pasa nada. */}
        {otras > 0 && (
          <button
            type="button"
            className="btn btn-inline btn-peligro"
            onClick={() => cerrar({ todas: true }, 'todas')}
            disabled={cerrando !== null}
          >
            {cerrando === 'todas'
              ? 'Cerrando…'
              : `Cerrar las otras ${otras === 1 ? 'sesión' : `${otras} sesiones`}`}
          </button>
        )}
      </div>

      {fallo && (
        <div className="notice error" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0 }}>{fallo}</p>
        </div>
      )}

      <ul className="sesiones">
        {filas.map((s) => (
          <li key={s.id} className={s.esActual ? 'sesion actual' : 'sesion'}>
            <span className="sesion-icono" aria-hidden="true">
              {ICONO[s.tipo]}
            </span>

            <div className="sesion-datos">
              <div className="sesion-titulo">
                {s.dispositivo}
                {s.esActual && <span className="etiqueta-actual">Esta sesión</span>}
              </div>
              <div className="sesion-meta">
                {s.ip ?? 'IP desconocida'} · iniciada {haceCuanto(s.iniciadaEn, ahora)}
                {s.ultimoUsoEn && ` · activa ${haceCuanto(s.ultimoUsoEn, ahora)}`}
              </div>
            </div>

            {/*
              La actual no se puede cerrar desde aquí.
              Cerrarla es salir, y ya existe el botón "Salir" arriba. Mezclarlas
              haría que alguien que quiere echar a un intruso se eche a sí mismo
              a mitad de la operación — con el intruso todavía dentro.
            */}
            {s.esActual ? (
              <span className="sesion-nota">Estás aquí</span>
            ) : (
              <button
                type="button"
                className="btn-link sesion-cerrar"
                onClick={() => cerrar({ sesionId: s.id }, s.id)}
                disabled={cerrando !== null}
              >
                {cerrando === s.id ? 'Cerrando…' : 'Cerrar'}
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="sesiones-pie">
        Una sesión se cierra sola a los 30 días sin usarse. Cerrarla aquí
        obliga a volver a escribir la contraseña en ese dispositivo.
      </p>
    </section>
  );
}
