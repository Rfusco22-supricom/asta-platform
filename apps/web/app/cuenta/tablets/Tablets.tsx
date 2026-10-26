'use client';

import { useState } from 'react';
import type { CodigoTablet as Codigo, Kiosco } from '@asta/shared-types';
import { CodigoTablet } from '@/components/CodigoTablet';

/**
 * Las tablets de la tienda del cliente: añadir una (con un código de 6 dígitos)
 * y desactivar las que ya no use. La pareja de `admin/kioscos/Kioscos.tsx`, sin
 * almacén ni token: la tablet del cliente enseña solo compatibilidades.
 */

function haceCuanto(iso: string | null): string {
  if (!iso) return 'Sin actividad todavía';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return 'Activa ahora';
  if (min < 60) return `Última actividad hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Última actividad hace ${h} h`;
  const d = Math.round(h / 24);
  return `Última actividad hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function enLinea(k: Kiosco): boolean {
  return k.activo && k.ultimaConexion !== null && Date.now() - new Date(k.ultimaConexion).getTime() < 30 * 60_000;
}

async function enviar(url: string, metodo: 'POST' | 'PATCH', cuerpo: unknown) {
  const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'No se pudo completar.');
  return body.data;
}

export function Tablets({ inicial, descargas }: { inicial: Kiosco[]; descargas: { ios: string | null; android: string | null } }) {
  const [tablets, setTablets] = useState(inicial);
  const [codigo, setCodigo] = useState<Codigo | null>(null);
  const [conectada, setConectada] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function pedirCodigo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setOcupado('codigo');
    setMensaje(null);
    try {
      const tienda = String(d.get('tienda') ?? '').trim();
      setCodigo((await enviar('/api/tablets/codigos', 'POST', { nombre: String(d.get('nombre') ?? ''), ...(tienda ? { tienda } : {}) })) as Codigo);
      setConectada(false);
      form.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMensaje({ tono: 'error', texto: (error as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  async function alternar(k: Kiosco) {
    setOcupado(k.id);
    setMensaje(null);
    try {
      const r = (await enviar('/api/tablets', 'PATCH', { id: k.id, activo: !k.activo })) as Kiosco;
      setTablets((ts) => ts.map((x) => (x.id === k.id ? r : x)));
      setMensaje({ tono: 'ok', texto: r.activo ? `«${r.nombre}» vuelve a funcionar.` : `«${r.nombre}» desactivada: deja de funcionar y pedirá un código nuevo.` });
    } catch (error) {
      setMensaje({ tono: 'error', texto: (error as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  const hayDescargas = descargas.ios || descargas.android;

  return (
    <div className="kio">
      {codigo && (
        <CodigoTablet
          codigo={codigo}
          urlEstado={`/api/tablets/codigos?id=${codigo.id}`}
          onConectada={(t) => {
            setConectada(true);
            setMensaje({ tono: 'ok', texto: `«${t.nombre}» conectada.` });
          }}
          onCerrar={() => {
            setCodigo(null);
            // La lista la pinta el servidor: con la tablet nueva, se vuelve a pedir.
            if (conectada) window.location.reload();
          }}
        />
      )}

      <section className="kio-alta" aria-labelledby="tab-alta-titulo">
        <div className="kio-alta-cabecera">
          <h2 id="tab-alta-titulo">Añadir una tablet</h2>
          <ol className="kio-pasos">
            <li>
              Instala la aplicación <strong>ASTA</strong> en la tablet
              {hayDescargas ? ':' : ' desde la App Store (iPad) o Google Play (Android).'}
              {hayDescargas && (
                <span className="tab-descargas">
                  {descargas.ios && (
                    <a href={descargas.ios} target="_blank" rel="noreferrer">
                      App Store (iPad)
                    </a>
                  )}
                  {descargas.android && (
                    <a href={descargas.android} target="_blank" rel="noreferrer">
                      Google Play (Android)
                    </a>
                  )}
                </span>
              )}
            </li>
            <li>Ponle un nombre aquí y pulsa «Añadir tablet»: sale un código de 6 dígitos.</li>
            <li>Abre la aplicación en la tablet y escribe el código (o escanea el QR). Entra sola.</li>
          </ol>
        </div>
        <form className="kio-formulario" onSubmit={pedirCodigo}>
          <label>
            <span>Nombre de la tablet</span>
            <input className="input" name="nombre" required minLength={2} maxLength={100} placeholder="Mostrador" />
          </label>
          <label>
            <span>Dónde está (opcional)</span>
            <input className="input" name="tienda" maxLength={150} placeholder="Sucursal centro" />
          </label>
          <button className="btn btn-inline" type="submit" disabled={ocupado === 'codigo'}>
            {ocupado === 'codigo' ? 'Pidiendo…' : 'Añadir tablet'}
          </button>
        </form>
      </section>

      {mensaje && (
        <p className={`kio-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
          {mensaje.texto}
        </p>
      )}

      <section aria-labelledby="tab-lista-titulo">
        <h2 id="tab-lista-titulo" className="kio-lista-titulo">
          Tus tablets <span className="pi-cuenta">{tablets.length}</span>
        </h2>
        {tablets.length === 0 ? (
          <div className="table-wrap">
            <div className="empty">Todavía no tienes ninguna tablet. Añade la primera arriba.</div>
          </div>
        ) : (
          <ul className="kio-lista">
            {tablets.map((k) => (
              <li key={k.id} className={`kio-tablet${k.activo ? '' : ' apagada'}`}>
                <div className="kio-tablet-info">
                  <div className="kio-tablet-nombre">
                    <span className={`kio-punto${enLinea(k) ? ' si' : ''}`} aria-hidden="true" />
                    {k.nombre}
                    {!k.activo && <span className="pi-insignia">Desactivada</span>}
                  </div>
                  <div className="kio-tablet-detalle">{k.tienda}</div>
                  <div className="kio-tablet-detalle">
                    {haceCuanto(k.ultimaConexion)}
                    {k.version ? ` · app ${k.version}` : ''}
                  </div>
                </div>
                <div className="kio-tablet-acciones">
                  <button type="button" className={k.activo ? 'btn-link kio-peligro' : 'btn btn-inline'} disabled={ocupado === k.id} onClick={() => void alternar(k)}>
                    {k.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
