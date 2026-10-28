'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TipoSellOut, ValidacionSellOut } from '@asta/shared-types';
import { nombreMes } from '@/lib/meses';

/**
 * Subir el sell-out de un mes: elegir mes y tipo, comprobar el archivo y, si
 * no tiene errores, guardarlo. Comprobar no guarda nada; guardar vuelve a
 * comprobar en el servidor.
 */

const n = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 2 });

function mesesElegibles(): string[] {
  const hoy = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function base64De(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

export function SubirSellOut() {
  const router = useRouter();
  const meses = mesesElegibles();
  const [mes, setMes] = useState(meses[1]!);
  const [tipo, setTipo] = useState<TipoSellOut>('VENTAS');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [validacion, setValidacion] = useState<ValidacionSellOut | null>(null);
  const [ocupado, setOcupado] = useState<'comprobar' | 'guardar' | null>(null);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  // Cambia al guardar: vacía el selector de archivo, que no se puede vaciar de otra forma.
  const [vuelta, setVuelta] = useState(0);

  function cambio() {
    setValidacion(null);
    setMensaje(null);
  }

  async function enviar(guardar: boolean) {
    if (!archivo) return;
    setOcupado(guardar ? 'guardar' : 'comprobar');
    setMensaje(null);
    try {
      const res = await fetch('/api/sellout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes, tipo, nombre: archivo.name, archivo: await base64De(archivo), guardar }),
      });
      const body = await res.json().catch(() => null);
      if (guardar && res.status === 201) {
        setValidacion(null);
        setArchivo(null);
        setVuelta((v) => v + 1);
        setMensaje({ tono: 'ok', texto: `Guardado: ${tipo === 'VENTAS' ? 'ventas' : 'inventario'} de ${nombreMes(mes).toLowerCase()}.` });
        router.refresh();
        return;
      }
      if (body?.data && 'errores' in body.data) setValidacion(body.data as ValidacionSellOut);
      else if (!res.ok) setMensaje({ tono: 'error', texto: body?.error?.message ?? 'No se pudo comprobar el archivo.' });
    } catch {
      setMensaje({ tono: 'error', texto: 'No se pudo contactar con el servidor.' });
    } finally {
      setOcupado(null);
    }
  }

  const listo = validacion !== null && validacion.errores.length === 0;

  return (
    <section className="panel so-subir" aria-labelledby="so-subir-titulo">
      <div className="so-subir-cabeza">
        <h2 id="so-subir-titulo">Subir un mes</h2>
        <a className="btn-link" href="/api/sellout/plantilla">
          Descargar la plantilla
        </a>
      </div>
      <div className="so-formulario">
        <label>
          <span>Mes</span>
          <select
            className="select"
            value={mes}
            onChange={(e) => {
              setMes(e.target.value);
              cambio();
            }}
          >
            {meses.map((m) => (
              <option key={m} value={m}>
                {nombreMes(m)}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Qué reportas">
          {(['VENTAS', 'INVENTARIO'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => {
                setTipo(t);
                cambio();
              }}
            >
              {t === 'VENTAS' ? 'Ventas del mes' : 'Inventario al cierre'}
            </button>
          ))}
        </div>
        <label className="so-archivo">
          <span>Archivo (Excel o CSV)</span>
          <input
            key={vuelta}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              setArchivo(e.target.files?.[0] ?? null);
              cambio();
            }}
          />
        </label>
        <div className="so-botones">
          <button type="button" className={listo ? 'btn-link' : 'btn btn-inline'} disabled={!archivo || ocupado !== null} onClick={() => void enviar(false)}>
            {ocupado === 'comprobar' ? 'Comprobando…' : 'Comprobar'}
          </button>
          {listo && (
            <button type="button" className="btn btn-inline" disabled={ocupado !== null} onClick={() => void enviar(true)}>
              {ocupado === 'guardar' ? 'Guardando…' : validacion!.reemplaza ? 'Guardar y sustituir el anterior' : 'Guardar'}
            </button>
          )}
        </div>
      </div>

      {validacion && (
        <div className={`so-resultado${validacion.errores.length ? ' con-errores' : ''}`} role="status">
          {validacion.errores.length === 0 ? (
            <p>
              ✓ {n(validacion.productos)} {validacion.productos === 1 ? 'producto' : 'productos'} · {n(validacion.unidades)} unidades
              {validacion.reemplaza && ' · sustituye al que ya había de este mes'}
            </p>
          ) : (
            <p>
              {validacion.errores.length} {validacion.errores.length === 1 ? 'error' : 'errores'}: corrígelos y vuelve a subirlo.
            </p>
          )}
          {[...validacion.errores, ...validacion.avisos].length > 0 && (
            <ul>
              {validacion.errores.slice(0, 20).map((e, i) => (
                <li key={`e${i}`} className="so-error">
                  Fila {e.fila}
                  {e.codigo ? ` · ${e.codigo}` : ''}: {e.motivo}
                </li>
              ))}
              {validacion.avisos.slice(0, 10).map((a, i) => (
                <li key={`a${i}`}>
                  Fila {a.fila}
                  {a.codigo ? ` · ${a.codigo}` : ''}: {a.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mensaje && (
        <p className={`kio-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
          {mensaje.texto}
        </p>
      )}
    </section>
  );
}
