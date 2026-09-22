'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EstadisticasRecomendador } from '@asta/shared-types';
import { fechaCorta } from '@/lib/formato';

/**
 * Las búsquedas que no encontraron nada, con el botón que las convierte en alias.
 *
 * Es el único sitio del panel donde un dato de telemetría se arregla en el acto:
 * se teclea la impresora que el cliente buscaba, se elige de la lista y la
 * próxima vez esa misma búsqueda funciona.
 *
 * ── Por qué hay que ELEGIR la impresora ──────────────────────────────────────
 *
 * Porque atar un alias a la impresora equivocada manda al cliente al tóner de
 * otra, que es peor que no encontrar nada. La lista usa la misma REGLA de
 * búsqueda que el kiosco, pero sobre todas las impresoras activas: las recién
 * importadas todavía no salen en el kiosco y son justo las que más alias
 * necesitan. Las que no ve el kiosco se marcan «sin validar».
 */

type Busqueda = EstadisticasRecomendador['sinResultado'][number];
interface Candidata {
  printerModelId: number;
  marca: string;
  nombre: string;
  /** El kiosco no enseña las impresoras sin compatibilidad validada (#111/#112). */
  visibleEnKiosco: boolean;
}

export function BusquedasSinResultado({ busquedas }: { busquedas: Busqueda[] }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [candidatas, setCandidatas] = useState<Candidata[]>([]);
  const [sugerencias, setSugerencias] = useState<Candidata[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);

  function abrir(b: Busqueda) {
    const misma = abierta === b.normalizada;
    setAbierta(misma ? null : b.normalizada);
    setCandidatas([]);
    setSugerencias([]);
    setMensaje(null);
    // Se parte del propio texto del cliente: si con él no sale nada, hay que
    // escribir el modelo real, que es justo lo que el alias va a enseñar.
    setTexto(misma ? '' : b.ejemplo);
  }

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (texto.trim().length < 2) return;
    setBuscando(true);
    setMensaje(null);
    try {
      const res = await fetch(`/api/compatibilidades/impresoras?q=${encodeURIComponent(texto.trim())}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo buscar.' });
        return;
      }
      setCandidatas(body.data ?? []);
      setSugerencias(body.sugerencias ?? []);
      if ((body.data ?? []).length === 0 && (body.sugerencias ?? []).length === 0) {
        setMensaje({ tono: 'error', texto: 'Ninguna impresora coincide. Si no existe, créala desde Compatibilidades → Impresoras.' });
      }
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setBuscando(false);
    }
  }

  async function atar(b: Busqueda, impresora: Candidata) {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/compatibilidades/impresoras', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Se guarda el texto del CLIENTE, no lo que se tecleó para encontrarla.
        body: JSON.stringify({ printerModelId: impresora.printerModelId, alias: b.ejemplo }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo guardar el alias.' });
        return;
      }
      const d = body.data as { creado: boolean; estabaDesactivado: boolean };
      setMensaje({
        tono: 'ok',
        texto: d.creado
          ? impresora.visibleEnKiosco
            ? `«${b.ejemplo}» ahora encuentra ${impresora.nombre}.`
            : `«${b.ejemplo}» queda atado a ${impresora.nombre}, pero el kiosco aún no la enseña: valida antes alguna compatibilidad suya en Compatibilidades → Impresoras.`
          : d.estabaDesactivado
            ? `Ese alias ya existía en ${impresora.nombre}, pero está desactivado. Se retiró a propósito: revísalo en Compatibilidades.`
            : `Ese alias ya estaba en ${impresora.nombre}.`,
      });
      setCandidatas([]);
      setSugerencias([]);
      router.refresh();
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setOcupado(false);
    }
  }

  const lista = (titulo: string, filas: Candidata[], b: Busqueda) =>
    filas.length > 0 && (
      <div className="alias-candidatas">
        <span className="sku">{titulo}</span>
        {filas.map((c) => (
          <button
            key={c.printerModelId}
            type="button"
            className="btn btn-inline"
            disabled={ocupado}
            onClick={() => void atar(b, c)}
            title={c.visibleEnKiosco ? undefined : 'El kiosco todavía no la enseña: le falta una compatibilidad validada'}
          >
            {c.marca} {c.nombre}
            {!c.visibleEnKiosco && <span className="sin-kiosco"> · sin validar</span>}
          </button>
        ))}
      </div>
    );

  return (
    <div className="table-wrap">
      <table className="tabla-busquedas">
        <thead>
          <tr>
            <th>Lo que se buscó</th>
            <th className="num">Veces</th>
            <th>Última vez</th>
            <th style={{ textAlign: 'right' }}>Alias</th>
          </tr>
        </thead>
        <tbody>
          {busquedas.map((b) => (
            <tr key={b.normalizada}>
              <td>
                <span className="codigo-cartucho">{b.ejemplo}</span>
                {b.variantes > 1 && <div className="sku">{b.variantes} formas distintas de escribirlo</div>}

                {abierta === b.normalizada && (
                  <div className="alias-panel">
                    <form onSubmit={buscar} className="alias-form">
                      <label htmlFor={`alias-${b.normalizada}`} className="sku">
                        ¿Qué impresora buscaba?
                      </label>
                      <div className="alias-campos">
                        <input
                          id={`alias-${b.normalizada}`}
                          className="input"
                          value={texto}
                          onChange={(e) => setTexto(e.target.value)}
                          placeholder="LaserJet Pro M404"
                          minLength={2}
                          autoFocus
                        />
                        <button type="submit" className="btn btn-inline" disabled={buscando || texto.trim().length < 2}>
                          {buscando ? 'Buscando…' : 'Buscar'}
                        </button>
                      </div>
                    </form>
                    {lista('Coincidencias:', candidatas, b)}
                    {candidatas.length === 0 && lista('¿Quisiste decir?', sugerencias, b)}
                    {mensaje && (
                      <p className={`revision-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
                        {mensaje.texto}
                      </p>
                    )}
                  </div>
                )}
              </td>
              <td className="num">{b.veces.toLocaleString('es-VE')}</td>
              <td className="sku">{fechaCorta(b.ultimaVez)}</td>
              <td style={{ textAlign: 'right' }}>
                <button type="button" className="btn btn-inline" disabled={ocupado} onClick={() => abrir(b)}>
                  {abierta === b.normalizada ? 'Cancelar' : 'Añadir como alias'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
