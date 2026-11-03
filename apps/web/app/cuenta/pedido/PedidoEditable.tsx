'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DIAS_COBERTURA, type LineaSugerida, type PedidoSugerido } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * El pedido sugerido, para ajustar y enviar: cada producto con lo sugerido ya
 * puesto. Poner 0 lo quita del pedido. Se envía a su vendedor, que lo pasa a
 * Odoo; aquí no se compra nada.
 */

const n = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 1 });

/** Por debajo de estos días, «se acaba pronto». */
const DIAS_PRONTO = 15;

function porQue(l: LineaSugerida): string {
  if (l.origen === 'SELLOUT') {
    const quedan = l.quedan ?? 0;
    return `Vendes ${n(l.ventaMensual ?? 0)} al mes y te ${quedan === 1 ? 'queda' : 'quedan'} ${n(quedan)}`;
  }
  return `Sueles comprar ${n(l.compraMensual)} al mes`;
}

export function PedidoEditable({ inicial }: { inicial: PedidoSugerido }) {
  const router = useRouter();
  const [cantidades, setCantidades] = useState(() => new Map(inicial.lineas.map((l) => [l.productId, l.sugeridas])));
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);

  const cambiar = (id: number, valor: number) => setCantidades((m) => new Map(m).set(id, Math.max(0, Math.min(100_000, Math.round(valor)))));
  const elegidas = inicial.lineas.filter((l) => (cantidades.get(l.productId) ?? 0) > 0);
  const unidades = elegidas.reduce((s, l) => s + (cantidades.get(l.productId) ?? 0), 0);
  const conPrecio = elegidas.every((l) => l.precio !== null);
  const total = elegidas.reduce((s, l) => s + (cantidades.get(l.productId) ?? 0) * (l.precio ?? 0), 0);

  async function enviar() {
    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineas: elegidas.map((l) => ({ productId: l.productId, cantidad: cantidades.get(l.productId) })), nota: nota.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo enviar el pedido.' });
        return;
      }
      setMensaje({ tono: 'ok', texto: 'Pedido enviado. Tu vendedor lo revisa y te confirma la cotización.' });
      setNota('');
      router.refresh();
    } catch {
      setMensaje({ tono: 'error', texto: 'No hay conexión. Prueba otra vez.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="panel so-marcar" aria-labelledby="pedido-titulo">
      <h2 id="pedido-titulo">Tu pedido sugerido</h2>
      <p className="stat-sub so-marcar-intro">
        {inicial.conSellOut
          ? `Calculado con lo que vendes, para que tengas ${DIAS_COBERTURA} días de venta. Ajusta las cantidades y envíalo a tu vendedor.`
          : 'Calculado con lo que sueles comprarnos al mes. Si reportas tu sell-out, lo calculamos con lo que vendes de verdad.'}
      </p>
      {mensaje && (
        <p className={mensaje.tono === 'error' ? 'so-error' : 'pedido-ok'} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
          {mensaje.texto}
        </p>
      )}

      {inicial.lineas.length === 0 ? (
        <div className="empty">{inicial.conSellOut ? 'Ahora no te hace falta reponer nada de ASTA.' : 'Todavía no tenemos compras tuyas de ASTA con las que sugerirte un pedido.'}</div>
      ) : (
        <>
          <ul className="so-marcar-lista">
            {inicial.lineas.map((l) => {
              const cantidad = cantidades.get(l.productId) ?? 0;
              return (
                <li key={l.productId} className={`so-marcar-fila${cantidad === 0 ? ' pedido-quitado' : ''}`}>
                  <div className="so-marcar-producto">
                    <strong>{l.nombre.replace(/^ASTA\s+/i, '')}</strong>
                    <span className="stat-sub">
                      {l.sku && <span className="sku">{l.sku}</span>} {porQue(l)}
                      {l.precio !== null && ` · ${money(l.precio)} c/u`}
                    </span>
                  </div>
                  <div className="so-marcar-quedan">
                    {l.diasQueQuedan !== null && l.diasQueQuedan <= DIAS_PRONTO ? (
                      <span className="tag so-reponer">{l.diasQueQuedan <= 0 ? 'Agotado' : `Se acaba en ${l.diasQueQuedan} días`}</span>
                    ) : (
                      <>
                        <b>{n(l.sugeridas)}</b>
                        <span>sugeridas</span>
                      </>
                    )}
                  </div>
                  <div className="so-marcar-contador">
                    <button type="button" aria-label={`Una menos de ${l.nombre}`} disabled={cantidad <= 0 || enviando} onClick={() => cambiar(l.productId, cantidad - 1)}>
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={cantidad}
                      disabled={enviando}
                      aria-label={`Cantidad de ${l.nombre}`}
                      onChange={(e) => cambiar(l.productId, Number(e.target.value) || 0)}
                    />
                    <button type="button" aria-label={`Una más de ${l.nombre}`} disabled={enviando} onClick={() => cambiar(l.productId, cantidad + 1)}>
                      +
                    </button>
                    <span className="stat-sub">unidades</span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="pedido-pie">
            <label className="pedido-nota">
              <span className="stat-sub">Nota para tu vendedor (opcional)</span>
              <textarea value={nota} maxLength={500} rows={2} disabled={enviando} onChange={(e) => setNota(e.target.value)} placeholder="Por ejemplo: lo necesito antes del viernes" />
            </label>
            <div className="pedido-total">
              <span className="stat-sub">
                {elegidas.length} {elegidas.length === 1 ? 'producto' : 'productos'} · {n(unidades)} unidades
              </span>
              <strong>{conPrecio ? `${money(total)} sin IVA` : 'Precio: te lo confirma tu vendedor'}</strong>
              <button type="button" className="btn" disabled={enviando || elegidas.length === 0} onClick={() => void enviar()}>
                {enviando ? 'Enviando…' : 'Enviar a mi vendedor'}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
