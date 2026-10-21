'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { AlmacenKiosco, Kiosco } from '@asta/shared-types';

/**
 * Alta y gestión de las tablets del kiosco (#120).
 *
 * El token sale UNA vez, al registrar o al pedir uno nuevo: no se guarda en
 * claro en ningún sitio, así que la pantalla lo enseña grande, con su QR, su
 * botón de copiar y los pasos para activar la tablet, y no deja seguir sin
 * decir que ya se activó.
 *
 * El token ES el código de activación: la aplicación ASTA lo pide la primera
 * vez que se abre (escaneando el QR o escribiéndolo), lo comprueba contra el
 * middleware y lo guarda en el almacén seguro de la tablet.
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

/** Verde si buscó algo en la última media hora. La actividad se apunta con cada consulta al recomendador. */
function enLinea(k: Kiosco): boolean {
  return k.activo && k.ultimaConexion !== null && Date.now() - new Date(k.ultimaConexion).getTime() < 30 * 60_000;
}

export function Kioscos({ inicial, almacenes, odooDisponible }: { inicial: Kiosco[]; almacenes: AlmacenKiosco[] | null; odooDisponible: boolean }) {
  const [kioscos, setKioscos] = useState(inicial);
  const [token, setToken] = useState<{ kiosco: Kiosco; token: string; nuevo: boolean } | null>(null);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const porCompania = useMemo(() => {
    const m = new Map<string, AlmacenKiosco[]>();
    for (const a of almacenes ?? []) m.set(a.compania, [...(m.get(a.compania) ?? []), a]);
    return [...m.entries()];
  }, [almacenes]);

  async function llamar(metodo: 'POST' | 'PUT' | 'PATCH', cuerpo: unknown) {
    const res = await fetch('/api/kioscos', { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? 'No se pudo completar.');
    return body.data;
  }

  async function registrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setOcupado('alta');
    setMensaje(null);
    try {
      const r = (await llamar('POST', {
        nombre: String(d.get('nombre') ?? ''),
        tienda: String(d.get('tienda') ?? ''),
        odooWarehouseId: Number(d.get('almacen')),
      })) as { kiosco: Kiosco; token: string };
      setKioscos((ks) => [r.kiosco, ...ks]);
      setToken({ ...r, nuevo: true });
      form.reset();
    } catch (error) {
      setMensaje({ tono: 'error', texto: (error as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  async function renovar(k: Kiosco) {
    setOcupado(k.id);
    setConfirmar(null);
    setMensaje(null);
    try {
      const r = (await llamar('PUT', { id: k.id })) as { kiosco: Kiosco; token: string };
      setKioscos((ks) => ks.map((x) => (x.id === k.id ? r.kiosco : x)));
      setToken({ ...r, nuevo: false });
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
      const r = (await llamar('PATCH', { id: k.id, activo: !k.activo })) as Kiosco;
      setKioscos((ks) => ks.map((x) => (x.id === k.id ? r : x)));
      setMensaje({ tono: 'ok', texto: r.activo ? `«${r.nombre}» vuelve a funcionar.` : `«${r.nombre}» desactivada: su token ya no entra.` });
    } catch (error) {
      setMensaje({ tono: 'error', texto: (error as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="kio">
      {token && <TokenRecienEmitido datos={token} onListo={() => setToken(null)} />}

      <section className="kio-alta" aria-labelledby="kio-alta-titulo">
        <div className="kio-alta-cabecera">
          <h2 id="kio-alta-titulo">Registrar una tablet</h2>
          <p>Cada tablet lleva su propio token. Solo sirve para el recomendador, y las existencias que enseña son las del almacén que elijas.</p>
        </div>
        {!almacenes ? (
          <div className="notice error" style={{ margin: 0 }}>
            <p>Odoo no responde ahora mismo, y hace falta para elegir el almacén. Las tablets de abajo siguen funcionando.</p>
          </div>
        ) : (
          <form className="kio-formulario" onSubmit={registrar}>
            <label>
              <span>Nombre de la tablet</span>
              <input className="input" name="nombre" required minLength={3} maxLength={100} placeholder="Tablet mostrador 1" />
            </label>
            <label>
              <span>Tienda</span>
              <input className="input" name="tienda" required minLength={2} maxLength={150} placeholder="Chacaíto, junto a caja" />
            </label>
            <label>
              <span>Almacén de Odoo</span>
              <select className="select" name="almacen" required defaultValue="">
                <option value="" disabled>
                  Elige el almacén de la tienda…
                </option>
                {porCompania.map(([compania, as]) => (
                  <optgroup key={compania} label={compania}>
                    {as.map((a) => (
                      <option key={a.warehouseId} value={a.warehouseId}>
                        {a.nombre}
                        {a.codigo ? ` (${a.codigo})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button className="btn btn-inline" type="submit" disabled={ocupado === 'alta'}>
              {ocupado === 'alta' ? 'Registrando…' : 'Registrar tablet'}
            </button>
          </form>
        )}
      </section>

      {mensaje && (
        <p className={`kio-mensaje ${mensaje.tono}`} role={mensaje.tono === 'error' ? 'alert' : 'status'}>
          {mensaje.texto}
        </p>
      )}

      <section aria-labelledby="kio-lista-titulo">
        <h2 id="kio-lista-titulo" className="kio-lista-titulo">
          Tablets <span className="pi-cuenta">{kioscos.length}</span>
        </h2>
        {!odooDisponible && kioscos.length > 0 && <p className="kio-nota">Sin Odoo no se ven los nombres de los almacenes; las tablets funcionan igual.</p>}
        {kioscos.length === 0 ? (
          <div className="table-wrap">
            <div className="empty">Todavía no hay ninguna tablet. Registra la primera arriba.</div>
          </div>
        ) : (
          <ul className="kio-lista">
            {kioscos.map((k) => (
              <li key={k.id} className={`kio-tablet${k.activo ? '' : ' apagada'}`}>
                <div className="kio-tablet-info">
                  <div className="kio-tablet-nombre">
                    <span className={`kio-punto${enLinea(k) ? ' si' : ''}`} aria-hidden="true" />
                    {k.nombre}
                    {!k.activo && <span className="pi-insignia">Desactivada</span>}
                  </div>
                  <div className="kio-tablet-detalle">
                    {k.tienda} · {k.almacen ?? `almacén #${k.odooWarehouseId}`}
                    {k.compania ? ` · ${k.compania}` : ''}
                  </div>
                  <div className="kio-tablet-detalle">
                    {haceCuanto(k.ultimaConexion)}
                    {k.version ? ` · app ${k.version}` : ''}
                  </div>
                </div>
                <div className="kio-tablet-acciones">
                  {confirmar === k.id ? (
                    <span className="kio-confirmar" role="group" aria-label="Confirmar token nuevo">
                      <span>El token actual dejará de funcionar.</span>
                      <button type="button" className="btn-link" onClick={() => setConfirmar(null)}>
                        Cancelar
                      </button>
                      <button type="button" className="btn btn-inline" disabled={ocupado === k.id} onClick={() => void renovar(k)}>
                        Sí, token nuevo
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" className="btn-link" disabled={ocupado === k.id || !k.activo} onClick={() => setConfirmar(k.id)}>
                        Token nuevo
                      </button>
                      <button type="button" className={k.activo ? 'btn-link kio-peligro' : 'btn btn-inline'} disabled={ocupado === k.id} onClick={() => void alternar(k)}>
                        {k.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TokenRecienEmitido({ datos, onListo }: { datos: { kiosco: Kiosco; token: string; nuevo: boolean }; onListo: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  // El QR se dibuja en el navegador: el token no sale de esta pantalla.
  // Oscuro sobre blanco siempre, también en el tema oscuro: es lo que leen bien las cámaras.
  useEffect(() => {
    let vigente = true;
    QRCode.toString(datos.token, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f2236', light: '#ffffff' } })
      .then((svg) => vigente && setQr(svg))
      .catch(() => vigente && setQr(null));
    return () => {
      vigente = false;
    };
  }, [datos.token]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(datos.token);
      setCopiado(true);
    } catch {
      // Sin portapapeles (http, permisos): que se pueda seleccionar a mano.
      const el = document.getElementById('kio-token');
      if (el) window.getSelection()?.selectAllChildren(el);
    }
  }

  return (
    <section className="kio-token" role="alertdialog" aria-labelledby="kio-token-titulo" aria-describedby="kio-token-aviso">
      <h2 id="kio-token-titulo">
        {datos.nuevo ? 'Tablet registrada' : 'Token nuevo'}: {datos.kiosco.nombre}
      </h2>
      <p id="kio-token-aviso" className="kio-token-aviso">
        <strong>Actívala ahora: el código no se vuelve a mostrar.</strong> Si se pierde, pide uno nuevo.
        {!datos.nuevo && ' El anterior ya no funciona.'}
      </p>
      <div className="kio-activar">
        {/* SVG generado aquí mismo por `qrcode` a partir del token: no lleva nada de fuera. */}
        {qr ? (
          <div className="kio-qr" role="img" aria-label="Código QR de activación de la tablet" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <div className="kio-qr kio-qr-vacio" aria-hidden="true" />
        )}
        <div className="kio-activar-texto">
          <ol className="kio-pasos">
            <li>En la tablet, abre la aplicación ASTA: la primera vez pide un código de activación.</li>
            <li>
              Pulsa <strong>Escanear el código</strong> y apunta la cámara a este QR. Si no hay cámara, escribe o pega el código de abajo.
            </li>
            <li>La tablet queda activada y no lo vuelve a pedir. Haz una búsqueda: aquí pasará a «Activa ahora».</li>
          </ol>
          <div className="kio-token-caja">
            <code id="kio-token">{datos.token}</code>
            <button type="button" className="btn btn-inline" onClick={() => void copiar()}>
              {copiado ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      </div>
      <div className="kio-token-pie">
        <button type="button" className="btn btn-inline" onClick={onListo}>
          Ya está activada
        </button>
      </div>
    </section>
  );
}
