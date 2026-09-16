'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CandidatoRevision, EstadoRevision, ProductoEnRevision } from '@asta/shared-types';
import { money, fechaCorta } from '@/lib/formato';

/**
 * La lista de productos a revisar, con sus candidatos.
 *
 * ── Qué se decide por fila ───────────────────────────────────────────────────
 *
 * Una fila es «este producto ES, o SUSTITUYE A, este cartucho». Se valida, se
 * rechaza o se devuelve a pendiente; y antes de validar se puede corregir si es
 * original o compatible, y el tipo del cartucho.
 *
 * Validar en lote existe para los casos obvios —«HP TONER 105A NEGRO ORIGINAL»
 * con candidato 105A—, pero la casilla solo está en las filas del estado que se
 * está mirando: seleccionar sin querer una ya validada y rechazarla desde la
 * pestaña de pendientes no debe poder pasar.
 *
 * ── Si otra persona decidió antes ────────────────────────────────────────────
 *
 * Cada petición lleva el estado que se ve en pantalla. Si ya no es ese, el
 * middleware responde 409 sin tocar nada, y aquí se dice y se recarga: se vuelve
 * a decidir sobre lo que hay, no sobre lo que había.
 */

const TIPOS = [
  { valor: 'TONER', titulo: 'Tóner' },
  { valor: 'TINTA', titulo: 'Tinta' },
  { valor: 'DRUM', titulo: 'Tambor' },
  { valor: 'OTRO', titulo: 'Otro' },
] as const;

const ETIQUETA_ESTADO: Record<EstadoRevision, { texto: string; clase: string }> = {
  PROPUESTA: { texto: 'pendiente', clase: 'estado-pendiente' },
  VALIDADA: { texto: 'validada', clase: 'estado-validada' },
  RECHAZADA: { texto: 'rechazada', clase: 'estado-rechazada' },
};

type Clave = `${number}:${number}`;
const claveDe = (p: ProductoEnRevision, c: CandidatoRevision): Clave => `${p.templateId}:${c.cartridgeId}`;

interface Fila {
  templateId: number;
  cartridgeId: number;
  estadoEsperado: EstadoRevision;
}

export function RevisionLista({ productos, estado }: { productos: ProductoEnRevision[]; estado: EstadoRevision }) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Set<Clave>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'error' | 'ok'; texto: string } | null>(null);
  /** Original/compatible elegido en pantalla y aún sin guardar, por fila. */
  const [relaciones, setRelaciones] = useState<Map<Clave, 'ORIGINAL' | 'COMPATIBLE'>>(new Map());

  const seleccionables = productos.flatMap((p) => p.candidatos.filter((c) => c.estado === estado).map((c) => claveDe(p, c)));
  const todas = seleccionables.length > 0 && seleccionables.every((k) => seleccion.has(k));

  function alternar(k: Clave) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  async function enviar(metodo: 'POST' | 'PATCH', cuerpo: unknown, exito: string) {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/compatibilidades', {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo guardar.' });
        // 409: alguien decidió antes. Lo que hay en pantalla ya no es cierto.
        if (res.status === 409) router.refresh();
        return false;
      }
      setMensaje({ tono: 'ok', texto: exito });
      setSeleccion(new Set());
      router.refresh();
      return true;
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function decidir(filas: Fila[], decision: EstadoRevision, relacion?: 'ORIGINAL' | 'COMPATIBLE') {
    const n = filas.length;
    const verbo = { VALIDADA: 'validada', RECHAZADA: 'rechazada', PROPUESTA: 'devuelta a pendiente' }[decision];
    // Una fila ya validada a la que solo se le cambia la relación no se «valida»: se guarda.
    const soloRelacion = n === 1 && relacion && filas[0].estadoEsperado === 'VALIDADA' && decision === 'VALIDADA';
    const exito = soloRelacion ? 'Relación guardada.' : n === 1 ? `Fila ${verbo}.` : `${n} filas ${decision === 'PROPUESTA' ? 'devueltas a pendiente' : `${verbo}s`}.`;
    return enviar('POST', { filas, decision, ...(relacion ? { relacion } : {}) }, exito);
  }

  function decidirSeleccion(decision: 'VALIDADA' | 'RECHAZADA') {
    const filas: Fila[] = [];
    for (const p of productos) {
      for (const c of p.candidatos) {
        if (seleccion.has(claveDe(p, c)) && c.estado === estado) {
          filas.push({ templateId: p.templateId, cartridgeId: c.cartridgeId, estadoEsperado: c.estado });
        }
      }
    }
    if (filas.length) void decidir(filas, decision);
  }

  return (
    <>
      <div className="revision-barra" role="region" aria-label="Acciones en lote">
        <label className="check" style={{ paddingBottom: 0 }}>
          <input
            type="checkbox"
            checked={todas}
            disabled={!seleccionables.length || ocupado}
            onChange={() => setSeleccion(todas ? new Set() : new Set(seleccionables))}
          />
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
        {productos.map((p) => (
          <article key={p.templateId} className="revision-producto">
            <header>
              <div>
                <div className="cliente-nombre">{p.nombre ?? <em>Ya no existe en Odoo</em>}</div>
                <div className="sku">
                  {p.sku ?? 'sin referencia'} · plantilla {p.templateId}
                  {p.nombre && !p.activoEnOdoo && <span className="tag prospecto" style={{ marginLeft: 8 }}>archivado o no a la venta</span>}
                </div>
              </div>
              <div className="num">
                {p.ventas12m > 0 ? money(p.ventas12m) : <span className="zero">sin ventas</span>}
                <div className="stat-sub">12 meses</div>
              </div>
            </header>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 24 }} aria-label="Seleccionar" />
                    <th>Cartucho y por qué se propuso</th>
                    <th>Tipo</th>
                    <th>Relación</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Decisión</th>
                  </tr>
                </thead>
                <tbody>
                  {p.candidatos.map((c) => {
                    const k = claveDe(p, c);
                    const relacion = relaciones.get(k) ?? c.relacion;
                    const fila: Fila = { templateId: p.templateId, cartridgeId: c.cartridgeId, estadoEsperado: c.estado };
                    const cambiada = relacion !== c.relacion;
                    return (
                      <tr key={k} className={c.estado === estado ? undefined : 'revision-contexto'}>
                        <td>
                          {c.estado === estado && (
                            <input type="checkbox" aria-label={`Seleccionar ${c.codigo}`} checked={seleccion.has(k)} disabled={ocupado} onChange={() => alternar(k)} />
                          )}
                        </td>
                        <td>
                          {/*
                            El motivo va junto al código y no en columna propia: con
                            una columna más, los botones de decidir quedaban fuera de
                            la vista en una pantalla de portátil.
                          */}
                          <span className="codigo-cartucho">{c.codigo}</span>
                          <div className="sku">
                            {c.marca} · {c.fuente.toLowerCase()}
                            {c.evidencia && (
                              <>
                                {' '}
                                <code className="evidencia" title="Fragmento del nombre que usó el importador">
                                  {c.evidencia}
                                </code>
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          <select
                            className="select select-compacto"
                            aria-label={`Tipo de ${c.codigo}`}
                            value={c.tipo}
                            disabled={ocupado}
                            title="Cambia el tipo del cartucho en todos los productos que lo usan"
                            onChange={(e) => void enviar('PATCH', { cartridgeId: c.cartridgeId, tipo: e.target.value }, `Tipo de ${c.codigo} corregido en todos sus productos.`)}
                          >
                            {TIPOS.map((t) => (
                              <option key={t.valor} value={t.valor}>
                                {t.titulo}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="select select-compacto"
                            aria-label={`Relación de ${c.codigo}`}
                            value={relacion}
                            disabled={ocupado}
                            onChange={(e) =>
                              setRelaciones((m) => new Map(m).set(k, e.target.value as 'ORIGINAL' | 'COMPATIBLE'))
                            }
                          >
                            <option value="ORIGINAL">Original</option>
                            <option value="COMPATIBLE">Compatible</option>
                          </select>
                          {cambiada && <div className="stat-sub">se guarda al validar</div>}
                        </td>
                        <td>
                          <span className={`tag ${ETIQUETA_ESTADO[c.estado].clase}`}>{ETIQUETA_ESTADO[c.estado].texto}</span>
                          {c.revisadoPor && (
                            <div className="sku" title={c.revisadoEn ?? undefined}>
                              {c.revisadoPor}
                              {c.revisadoEn && ` · ${fechaCorta(c.revisadoEn)}`}
                            </div>
                          )}
                        </td>
                        <td className="revision-acciones">
                          {(c.estado !== 'VALIDADA' || cambiada) && (
                            <button type="button" className="btn btn-inline btn-validar" disabled={ocupado} onClick={() => void decidir([fila], 'VALIDADA', cambiada ? relacion : undefined)}>
                              {c.estado === 'VALIDADA' ? 'Guardar' : 'Validar'}
                            </button>
                          )}
                          {c.estado !== 'RECHAZADA' && (
                            <button type="button" className="btn-link" disabled={ocupado} onClick={() => void decidir([fila], 'RECHAZADA')}>
                              Rechazar
                            </button>
                          )}
                          {c.estado !== 'PROPUESTA' && (
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
        ))}
      </div>
    </>
  );
}
