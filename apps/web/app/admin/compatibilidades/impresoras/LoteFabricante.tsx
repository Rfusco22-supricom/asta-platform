'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoteFabricante as Lote } from '@asta/shared-types';

/**
 * Validar de una vez lo pendiente de las listas OFICIALES del fabricante.
 *
 * Son las tablas que publican HP, Canon, Epson… con su página de origen: lo
 * más fiable que hay. Revisarlas una a una retrasaba que el kiosco empezara a
 * recomendar. Lo de otras fuentes (el nombre del producto, un vendedor) sigue
 * pasando por la revisión de abajo.
 *
 * Pide confirmar con la cifra a la vista, y el servidor valida exactamente esa:
 * si entretanto cambió, no valida nada y se recarga.
 */

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function LoteFabricante({ lote }: { lote: Lote }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const sitios = [...new Set(lote.fuentes.map(dominio))];

  async function validar() {
    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/compatibilidades/lote-fabricante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ esperadas: lote.propuestas }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({
          tono: 'error',
          texto: res.status === 409 ? 'La cifra cambió mientras mirabas. No se validó nada: revisa la nueva.' : (body?.error?.message ?? 'No se pudo validar.'),
        });
        router.refresh();
        return;
      }
      setMensaje({ tono: 'ok', texto: `${body.data.validadas.toLocaleString('es-VE')} compatibilidades validadas.` });
      setConfirmando(false);
      router.refresh();
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="lote" aria-labelledby="lote-titulo">
      <div className="lote-texto">
        <h2 id="lote-titulo">
          Listas oficiales del fabricante: <strong>{lote.propuestas.toLocaleString('es-VE')}</strong> sin revisar
        </h2>
        <p>
          {lote.impresoras.toLocaleString('es-VE')} impresoras y {lote.cartuchos.toLocaleString('es-VE')} tóners, sacados de las tablas que publica cada marca
          {sitios.length > 0 && (
            <>
              {' '}(<span className="lote-sitios">{sitios.slice(0, 4).join(', ')}{sitios.length > 4 ? ` y ${sitios.length - 4} más` : ''}</span>)
            </>
          )}
          . Es lo más fiable que hay: se pueden validar todas de una vez. Lo de otras fuentes sigue en la revisión de abajo.
        </p>
        {mensaje && (
          <p className={`lote-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
            {mensaje.tono === 'ok' ? '✓ ' : ''}
            {mensaje.texto}
          </p>
        )}
      </div>
      <div className="lote-acciones">
        {confirmando ? (
          <>
            <span className="lote-pregunta">¿Validar las {lote.propuestas.toLocaleString('es-VE')}?</span>
            <button type="button" className="btn-link" disabled={enviando} onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-inline btn-validar" disabled={enviando} onClick={() => void validar()}>
              {enviando ? 'Validando…' : 'Sí, validar'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-inline btn-validar" onClick={() => setConfirmando(true)}>
            Validar las {lote.propuestas.toLocaleString('es-VE')}
          </button>
        )}
      </div>
    </section>
  );
}
