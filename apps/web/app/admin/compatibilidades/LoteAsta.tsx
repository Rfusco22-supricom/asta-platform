'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ParAstaClaro } from '@asta/shared-types';

/**
 * Validar de una vez los casos claros del tramo producto → cartucho: productos
 * ASTA a la venta, que no son polvo ni chip, con el código exacto del cartucho
 * en el nombre («ASTA TONER CF258A CON CHIP» → CF258A).
 *
 * A diferencia de las listas oficiales, esto sale de leer nombres: por eso la
 * lista entera está a la vista antes de validar, y el servidor vuelve a
 * comprobar cada par al aplicar. Lo demás sigue en la revisión de abajo.
 */

export function LoteAsta({ pares }: { pares: ParAstaClaro[] }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const productos = new Set(pares.map((p) => p.templateId)).size;

  async function validar() {
    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/compatibilidades/lote-asta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pares: pares.map(({ templateId, cartridgeId }) => ({ templateId, cartridgeId })) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo validar.' });
        router.refresh();
        return;
      }
      setMensaje({ tono: 'ok', texto: `${body.data.validadas.toLocaleString('es-VE')} validadas.` });
      setConfirmando(false);
      router.refresh();
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="lote" aria-labelledby="lote-asta-titulo">
      <div className="lote-texto">
        <h2 id="lote-asta-titulo">
          Productos ASTA con el código exacto en el nombre: <strong>{pares.length.toLocaleString('es-VE')}</strong> sin revisar
        </h2>
        <p>
          {productos.toLocaleString('es-VE')} productos ASTA a la venta cuyo nombre trae el código del cartucho tal cual, como «ASTA TONER CF258A CON CHIP» →
          CF258A. Sin polvo ni chips sueltos. Revisa la lista y, si está bien, valídalos todos de una vez.
        </p>
        <button type="button" className="btn-link lote-ver" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
          {abierta ? 'Ocultar la lista' : `Ver la lista (${pares.length})`}
        </button>
        {abierta && (
          <div className="lote-lista" role="region" aria-label="Pares a validar" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Cartucho</th>
                  <th>Producto ASTA de Odoo</th>
                </tr>
              </thead>
              <tbody>
                {pares.map((p) => (
                  <tr key={`${p.templateId}:${p.cartridgeId}`}>
                    <td>
                      <span className="pi-chip-codigo">{p.codigo}</span> <span className="lote-marca">{p.marca}</span>
                    </td>
                    <td>
                      {p.nombre}
                      {p.sku && <span className="lote-sku"> · {p.sku}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            <span className="lote-pregunta">¿Validar los {pares.length.toLocaleString('es-VE')}?</span>
            <button type="button" className="btn-link" disabled={enviando} onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-inline btn-validar" disabled={enviando} onClick={() => void validar()}>
              {enviando ? 'Validando…' : 'Sí, validar'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-inline btn-validar" onClick={() => setConfirmando(true)}>
            Validar los {pares.length.toLocaleString('es-VE')}
          </button>
        )}
      </div>
    </section>
  );
}
