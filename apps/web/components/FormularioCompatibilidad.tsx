'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * «A esta impresora le sirve este cartucho», para añadir desde el panel (#56).
 *
 * Lo usan el administrador y el vendedor, pero NO con el mismo resultado, y no lo
 * decide este formulario: cada uno envía a su propio puente, y el middleware crea
 * VALIDADA desde la ruta del administrador y PROPUESTA desde la del vendedor. Aquí
 * solo cambia el texto que lo explica.
 */

const MARCAS_HABITUALES = ['HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Xerox', 'Lexmark', 'Kyocera', 'Ricoh', 'Pantum'];

const TIPOS = [
  { valor: 'TONER', titulo: 'Tóner' },
  { valor: 'TINTA', titulo: 'Tinta' },
  { valor: 'DRUM', titulo: 'Tambor' },
  { valor: 'OTRO', titulo: 'Otro (chip, kit…)' },
];

export function FormularioCompatibilidad({
  como,
  marcas = [],
  codigoInicial,
}: {
  como: 'admin' | 'vendedor';
  marcas?: string[];
  /** Cartucho que falta, si se llegó desde la cobertura del top (#56). */
  codigoInicial?: string;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [otraMarca, setOtraMarca] = useState(false);
  const sugerencias = [...new Set([...marcas, ...MARCAS_HABITUALES])];

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const cuerpo = {
      marcaImpresora: String(d.get('marcaImpresora') ?? ''),
      modeloImpresora: String(d.get('modeloImpresora') ?? ''),
      codigoCartucho: String(d.get('codigoCartucho') ?? ''),
      tipo: String(d.get('tipo') ?? 'TONER'),
      ...(otraMarca && d.get('marcaCartucho') ? { marcaCartucho: String(d.get('marcaCartucho')) } : {}),
    };

    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch(como === 'admin' ? '/api/compatibilidades/impresoras' : '/api/compatibilidades/propuestas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo guardar.' });
        return;
      }
      const r = body.data as { estado: string; creada: boolean };
      const estado = { VALIDADA: 'validada', PROPUESTA: 'pendiente de revisión', RECHAZADA: 'rechazada' }[r.estado] ?? r.estado;
      setMensaje({
        tono: 'ok',
        texto: !r.creada
          ? `Esa compatibilidad ya existía (${estado}). No se ha cambiado.`
          : como === 'admin'
            ? `${cuerpo.codigoCartucho} → ${cuerpo.modeloImpresora}: añadida y validada.`
            : `${cuerpo.codigoCartucho} → ${cuerpo.modeloImpresora}: propuesta enviada. Un administrador la revisará.`,
      });
      // Se conserva la marca: lo normal es añadir varios modelos de la misma seguidos.
      (form.elements.namedItem('modeloImpresora') as HTMLInputElement).value = '';
      (form.elements.namedItem('codigoCartucho') as HTMLInputElement).value = '';
      router.refresh();
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="panel formulario-compatibilidad">
      <h2>Añadir compatibilidad</h2>
      <p className="formulario-nota">
        {codigoInicial
          ? `${codigoInicial} todavía no tiene ninguna impresora validada: es uno de los más vendidos y el kiosco no lo puede recomendar. Di qué impresora lo usa.`
          : como === 'admin'
            ? 'Lo que añades aquí queda validado y el kiosco lo recomienda en cuanto el cartucho tenga un producto validado.'
            : 'Lo que propones aquí lo revisa un administrador antes de que el kiosco lo recomiende.'}
      </p>
      <form onSubmit={enviar}>
        <datalist id="marcas-impresora">
          {sugerencias.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="formulario-campos">
          <div className="filtro-campo">
            <label htmlFor="fc-marca">Marca de la impresora</label>
            <input id="fc-marca" name="marcaImpresora" className="input" list="marcas-impresora" required minLength={2} maxLength={60} placeholder="HP" />
          </div>
          <div className="filtro-campo">
            <label htmlFor="fc-modelo">Modelo</label>
            <input id="fc-modelo" name="modeloImpresora" className="input" required minLength={2} maxLength={120} placeholder="LaserJet Pro M404dn" />
          </div>
          <div className="filtro-campo">
            <label htmlFor="fc-codigo">Código del cartucho</label>
            <input id="fc-codigo" name="codigoCartucho" className="input" required minLength={2} maxLength={40} placeholder="CF258A" defaultValue={codigoInicial} />
          </div>
          <div className="filtro-campo">
            <label htmlFor="fc-tipo">Tipo</label>
            <select id="fc-tipo" name="tipo" className="select" defaultValue="TONER">
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.titulo}
                </option>
              ))}
            </select>
          </div>
          {otraMarca && (
            <div className="filtro-campo">
              <label htmlFor="fc-marca-cartucho">Marca del cartucho</label>
              <input id="fc-marca-cartucho" name="marcaCartucho" className="input" list="marcas-impresora" minLength={2} maxLength={60} />
            </div>
          )}
          <button className="btn btn-inline" type="submit" disabled={enviando}>
            {enviando ? 'Guardando…' : como === 'admin' ? 'Añadir' : 'Proponer'}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={otraMarca} onChange={(e) => setOtraMarca(e.target.checked)} />
          El cartucho es de otra marca que la impresora
        </label>
        {mensaje && (
          <p className={`revision-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
            {mensaje.texto}
          </p>
        )}
      </form>
    </section>
  );
}
