'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CartuchoEnRevision, EstadoRevision, ImpresoraEnRevision } from '@asta/shared-types';
import { money, fechaCorta } from '@/lib/formato';

/**
 * Cartuchos con las impresoras a las que sirven, para validar o rechazar.
 *
 * Cada fila enseña el TEXTO ORIGINAL de la tabla de la que salió. Es lo que hace
 * revisable al importador: «LaserJet Pro P560» al lado de «P560/P566/567…» dice
 * enseguida que falta un «1», y se rechaza y se añade la buena con el formulario.
 *
 * Mismas reglas que la pestaña de productos: la casilla solo en las filas del
 * estado que se mira, y ante un 409 se avisa y se recarga.
 */

const TIPO: Record<CartuchoEnRevision['tipo'], string> = { TONER: 'tóner', TINTA: 'tinta', DRUM: 'tambor', OTRO: 'otro' };

const ETIQUETA: Record<EstadoRevision, { texto: string; clase: string }> = {
  PROPUESTA: { texto: 'pendiente', clase: 'estado-pendiente' },
  VALIDADA: { texto: 'validada', clase: 'estado-validada' },
  RECHAZADA: { texto: 'rechazada', clase: 'estado-rechazada' },
};

type Clave = `${number}:${number}`;
const claveDe = (c: CartuchoEnRevision, i: ImpresoraEnRevision): Clave => `${c.cartridgeId}:${i.printerModelId}`;

interface Fila {
  cartridgeId: number;
  printerModelId: number;
  estadoEsperado: EstadoRevision;
}

/** "compatibilidad_productos #81: HP LaserJet…" → "#81 · HP LaserJet…" */
function origenLegible(origen: string | null): string | null {
  return origen ? origen.replace(/^compatibilidad_productos\s+#(\d+):\s*/, '#$1 · ') : null;
}

export function RevisionImpresoras({ cartuchos, estado }: { cartuchos: CartuchoEnRevision[]; estado: EstadoRevision }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Set<Clave>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'error' | 'ok'; texto: string } | null>(null);

  const seleccionables = cartuchos.flatMap((c) => c.impresoras.filter((i) => i.estado === estado).map((i) => claveDe(c, i)));
  const todas = seleccionables.length > 0 && seleccionables.every((k) => seleccion.has(k));

  async function decidir(filas: Fila[], decision: EstadoRevision) {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/compatibilidades/impresoras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas, decision }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo guardar.' });
        if (res.status === 409) router.refresh();
        return;
      }
      const verbo = { VALIDADA: 'validada', RECHAZADA: 'rechazada', PROPUESTA: 'devuelta a pendiente' }[decision];
      const n = filas.length;
      setMensaje({ tono: 'ok', texto: n === 1 ? `Compatibilidad ${verbo}.` : `${n} compatibilidades ${decision === 'PROPUESTA' ? 'devueltas a pendiente' : `${verbo}s`}.` });
      setSeleccion(new Set());
      router.refresh();
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setOcupado(false);
    }
  }

  function decidirSeleccion(decision: 'VALIDADA' | 'RECHAZADA') {
    const filas: Fila[] = [];
    for (const c of cartuchos) {
      for (const i of c.impresoras) {
        if (seleccion.has(claveDe(c, i)) && i.estado === estado) filas.push({ cartridgeId: c.cartridgeId, printerModelId: i.printerModelId, estadoEsperado: i.estado });
      }
    }
    if (filas.length) void decidir(filas, decision);
  }

  function alternarCartucho(c: CartuchoEnRevision) {
    const claves = c.impresoras.filter((i) => i.estado === estado).map((i) => claveDe(c, i));
    const todasMarcadas = claves.every((k) => seleccion.has(k));
    setSeleccion((s) => {
      const n = new Set(s);
      for (const k of claves) {
        if (todasMarcadas) n.delete(k);
        else n.add(k);
      }
      return n;
    });
  }

  return (
    <>
      <div className="revision-barra" role="region" aria-label="Acciones en lote">
        <label className="check" style={{ paddingBottom: 0 }}>
          <input type="checkbox" checked={todas} disabled={!seleccionables.length || ocupado} onChange={() => setSeleccion(todas ? new Set() : new Set(seleccionables))} />
          Seleccionar las {seleccionables.length} de esta página
        </label>
        {seleccion.size > 0 && (
          <span className="revision-lote">
            <strong>{seleccion.size}</strong> seleccionadas
            {estado !== 'VALIDADA' && (
              <button type="button" className="btn btn-inline btn-validar" disabled={ocupado} onClick={() => decidirSeleccion('VALIDADA')}>
                Validar
              </button>
            )}
            {estado !== 'RECHAZADA' && (
              <button type="button" className="btn btn-inline btn-peligro" disabled={ocupado} onClick={() => decidirSeleccion('RECHAZADA')}>
                Rechazar
              </button>
            )}
          </span>
        )}
        {mensaje && (
          <span className={`revision-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
            {mensaje.texto}
          </span>
        )}
      </div>

      <div className="revision-productos">
        {cartuchos.map((c) => {
          const delEstado = c.impresoras.filter((i) => i.estado === estado).length;
          return (
            <article key={c.cartridgeId} className="revision-producto">
              <header>
                <div>
                  <div className="cliente-nombre">
                    <span className="codigo-cartucho">{c.codigo}</span> · {c.marca}
                  </div>
                  <div className="sku">
                    {TIPO[c.tipo]}
                    {c.color && ` · ${c.color}`}
                    {c.rendimientoPaginas && ` · ${c.rendimientoPaginas.toLocaleString('es-VE')} págs.`}
                    {' · '}
                    {c.productosValidados > 0 ? (
                      `${c.productosValidados} ${c.productosValidados === 1 ? 'producto validado' : 'productos validados'}`
                    ) : (
                      <span className="aviso-producto" title="Sin un producto validado, el kiosco no tiene qué ofrecer para este cartucho">
                        sin producto validado{c.productosPendientes ? ` (${c.productosPendientes} pendientes)` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="num">
                  {c.ventas12m > 0 ? money(c.ventas12m) : <span className="zero">sin ventas</span>}
                  <div className="stat-sub">12 meses</div>
                </div>
              </header>

              <div className="table-wrap">
                <table className="tabla-impresoras">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}>
                        {delEstado > 1 && (
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar las impresoras de ${c.codigo}`}
                            disabled={ocupado}
                            checked={c.impresoras.filter((i) => i.estado === estado).every((i) => seleccion.has(claveDe(c, i)))}
                            onChange={() => alternarCartucho(c)}
                          />
                        )}
                      </th>
                      <th>Impresora y de dónde salió</th>
                      <th>Estado</th>
                      <th style={{ textAlign: 'right' }}>Decisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.impresoras.map((i) => {
                      const k = claveDe(c, i);
                      const fila: Fila = { cartridgeId: c.cartridgeId, printerModelId: i.printerModelId, estadoEsperado: i.estado };
                      const origen = origenLegible(i.origen);
                      return (
                        <tr key={k} className={i.estado === estado ? undefined : 'revision-contexto'}>
                          <td>
                            {i.estado === estado && (
                              <input type="checkbox" aria-label={`Seleccionar ${i.nombre}`} checked={seleccion.has(k)} disabled={ocupado} onChange={() => setSeleccion((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                            )}
                          </td>
                          <td>
                            <span className="impresora-nombre">
                              {i.marca} {i.nombre}
                            </span>
                            <div className="sku">
                              {origen ? <span title={i.origen ?? undefined}>{origen}</span> : i.propuestaPor ? `propuesta por ${i.propuestaPor}` : i.fuente.toLowerCase()}
                            </div>
                          </td>
                          <td>
                            <span className={`tag ${ETIQUETA[i.estado].clase}`}>{ETIQUETA[i.estado].texto}</span>
                            {i.revisadoPor && (
                              <div className="sku">
                                {i.revisadoPor}
                                {i.revisadoEn && ` · ${fechaCorta(i.revisadoEn)}`}
                              </div>
                            )}
                          </td>
                          <td className="revision-acciones">
                            {i.estado !== 'VALIDADA' && (
                              <button type="button" className="btn btn-inline btn-validar" disabled={ocupado} onClick={() => void decidir([fila], 'VALIDADA')}>
                                Validar
                              </button>
                            )}
                            {i.estado !== 'RECHAZADA' && (
                              <button type="button" className="btn-link" disabled={ocupado} onClick={() => void decidir([fila], 'RECHAZADA')}>
                                Rechazar
                              </button>
                            )}
                            {i.estado !== 'PROPUESTA' && (
                              <button type="button" className="btn-link" disabled={ocupado} onClick={() => void decidir([fila], 'PROPUESTA')}>
                                Deshacer
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
