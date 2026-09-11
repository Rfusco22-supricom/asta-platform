'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LARGO_MAXIMO_NOTA, type ClientNote } from '@asta/shared-types';

/**
 * Notas del vendedor sobre un cliente (issue #24).
 *
 * Client Component: escribir, borrar y ver el contador de caracteres es
 * interacción pura de navegador.
 *
 * Tras cada cambio se llama a `router.refresh()` en vez de mantener una copia
 * de la lista en el cliente. Así el servidor vuelve a ser la única fuente de
 * verdad y no puede quedarse una lista "optimista" que no coincida con lo que
 * realmente se guardó.
 */

export function Notas({
  partnerId,
  notas,
  disponibles,
}: {
  partnerId: number;
  notas: ClientNote[];
  disponibles: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const restantes = LARGO_MAXIMO_NOTA - texto.length;
  const vacia = texto.trim().length === 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (vacia || guardando) return;

    setGuardando(true);
    setFallo(null);
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, texto }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFallo(body?.error?.message ?? 'No se pudo guardar la nota.');
        return;
      }
      // Solo se limpia el cuadro si SE GUARDÓ. Vaciarlo antes de saberlo
      // perdería lo escrito cuando falla la red.
      setTexto('');
      router.refresh();
    } catch {
      setFallo('No se pudo contactar con el servidor. Tu texto sigue aquí.');
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(notaId: string) {
    setBorrando(notaId);
    setFallo(null);
    try {
      const res = await fetch('/api/notas', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, notaId }),
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        setFallo(body?.error?.message ?? 'No se pudo borrar.');
        return;
      }
      router.refresh();
    } catch {
      setFallo('No se pudo contactar con el servidor.');
    } finally {
      setBorrando(null);
    }
  }

  if (!disponibles) {
    return (
      <section className="panel">
        <h2>Notas del vendedor</h2>
        <div className="aviso-pendiente">
          <strong>No se pudieron cargar las notas.</strong> La base de datos no responde.
          Los datos de facturación de arriba vienen de Odoo y no están afectados.
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Notas del vendedor</h2>

      <form onSubmit={guardar} style={{ marginBottom: notas.length ? 18 : 0 }}>
        <textarea
          className="input nota-texto"
          placeholder="Qué se habló, qué quedó pendiente, con quién hay que insistir…"
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, LARGO_MAXIMO_NOTA))}
          rows={3}
          aria-label="Escribir una nota"
        />
        <div className="nota-pie">
          {/* El contador solo aparece cerca del límite: enseñarlo siempre es
              ruido para una nota de dos líneas. */}
          <span className={restantes < 200 ? 'nota-contador cerca' : 'nota-contador'}>
            {restantes < 200 ? `${restantes} caracteres restantes` : ''}
          </span>
          <button type="submit" className="btn btn-inline" disabled={vacia || guardando}>
            {guardando ? 'Guardando…' : 'Guardar nota'}
          </button>
        </div>
      </form>

      {fallo && (
        <div className="notice error" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0 }}>{fallo}</p>
        </div>
      )}

      {notas.length === 0 ? (
        <div className="empty" style={{ padding: '24px 20px' }}>
          Todavía no hay notas sobre este cliente.
        </div>
      ) : (
        <ul className="notas">
          {notas.map((n) => (
            <li key={n.id} className="nota">
              <div className="nota-cabecera">
                <strong>{n.autorNombre}</strong>
                <span className="nota-fecha">
                  {new Date(n.creadoEn).toLocaleString('es-VE', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {/* Solo las propias. La nota de otro vendedor es el registro de
                    una conversación que no tuvo quien mira. */}
                {n.esMia && (
                  <button
                    type="button"
                    className="btn-link nota-borrar"
                    onClick={() => borrar(n.id)}
                    disabled={borrando === n.id}
                  >
                    {borrando === n.id ? 'Borrando…' : 'Borrar'}
                  </button>
                )}
              </div>
              {/* `white-space: pre-wrap` en el CSS: si alguien escribe con
                  saltos de línea, se respetan. */}
              <div className="nota-cuerpo">{n.texto}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
