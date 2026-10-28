'use client';

import { useMemo, useState } from 'react';
import type { AlmacenKiosco, CodigoRevision, CodigoTablet as Codigo, Kiosco } from '@asta/shared-types';
import { CodigoTablet } from '@/components/CodigoTablet';

/**
 * Las tablets con la aplicación ASTA (#120), vistas por el administrador.
 *
 * La app de la tienda de apps no lleva token: se vincula con un código que se
 * pide aquí («Añadir tablet») y se escribe, o se escanea como QR, en la tablet.
 * Las de Supricom llevan almacén y enseñan existencias. Las de los clientes las
 * vincula cada cliente desde su cuenta, y salen aquí también.
 *
 * Además: el código de los revisores de Apple y Google, y el alta a mano con el
 * token a la vista para una app compilada con él dentro.
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

/** De quién es y qué enseña. */
function dondeEsta(k: Kiosco): string {
  if (k.odooWarehouseId !== null) {
    return `${k.tienda} · ${k.almacen ?? `almacén #${k.odooWarehouseId}`}${k.compania ? ` · ${k.compania}` : ''}`;
  }
  if (k.odooPartnerId !== null) return `Cliente: ${k.cliente ?? `#${k.odooPartnerId}`} · ${k.tienda} · solo compatibilidades`;
  return `${k.tienda} · solo compatibilidades`;
}

async function enviar(url: string, metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE', cuerpo?: unknown) {
  const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'No se pudo completar.');
  return body.data;
}

export function Kioscos({
  inicial,
  almacenes,
  revisionInicial,
}: {
  inicial: Kiosco[];
  almacenes: AlmacenKiosco[] | null;
  revisionInicial: CodigoRevision | null;
}) {
  const [kioscos, setKioscos] = useState(inicial);
  const [codigo, setCodigo] = useState<{ codigo: Codigo; revision: boolean } | null>(null);
  const [revision, setRevision] = useState(revisionInicial);
  const [token, setToken] = useState<{ kiosco: Kiosco; token: string; nuevo: boolean } | null>(null);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [conectada, setConectada] = useState(false);

  function fallo(error: unknown) {
    setMensaje({ tono: 'error', texto: (error as Error).message });
  }

  async function pedirCodigo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setOcupado('codigo');
    setMensaje(null);
    try {
      const c = (await enviar('/api/kioscos/codigos', 'POST', {
        nombre: String(d.get('nombre') ?? ''),
        tienda: String(d.get('tienda') ?? ''),
        odooWarehouseId: Number(d.get('almacen')),
      })) as Codigo;
      setCodigo({ codigo: c, revision: false });
      form.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      fallo(error);
    } finally {
      setOcupado(null);
    }
  }

  async function nuevoCodigoRevision() {
    setOcupado('revision');
    setMensaje(null);
    try {
      const c = (await enviar('/api/kioscos/revision', 'POST')) as Codigo;
      setCodigo({ codigo: c, revision: true });
      setRevision({ id: c.id, creadoEn: new Date().toISOString(), usos: 0, ultimoUso: null });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      fallo(error);
    } finally {
      setOcupado(null);
    }
  }

  async function revocarRevision() {
    setOcupado('revision');
    setMensaje(null);
    try {
      await enviar('/api/kioscos/revision', 'DELETE');
      setRevision(null);
      setMensaje({ tono: 'ok', texto: 'Código de revisión revocado. Las tablets que ya entraron con él siguen en la lista: desactívalas si hace falta.' });
    } catch (error) {
      fallo(error);
    } finally {
      setOcupado(null);
    }
  }

  async function registrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setOcupado('alta');
    setMensaje(null);
    try {
      const r = (await enviar('/api/kioscos', 'POST', {
        nombre: String(d.get('nombre') ?? ''),
        tienda: String(d.get('tienda') ?? ''),
        odooWarehouseId: Number(d.get('almacen')),
      })) as { kiosco: Kiosco; token: string };
      setKioscos((ks) => [r.kiosco, ...ks]);
      setToken({ ...r, nuevo: true });
      form.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      fallo(error);
    } finally {
      setOcupado(null);
    }
  }

  async function renovar(k: Kiosco) {
    setOcupado(k.id);
    setConfirmar(null);
    setMensaje(null);
    try {
      const r = (await enviar('/api/kioscos', 'PUT', { id: k.id })) as { kiosco: Kiosco; token: string };
      setKioscos((ks) => ks.map((x) => (x.id === k.id ? r.kiosco : x)));
      setToken({ ...r, nuevo: false });
    } catch (error) {
      fallo(error);
    } finally {
      setOcupado(null);
    }
  }

  async function alternar(k: Kiosco) {
    setOcupado(k.id);
    setMensaje(null);
    try {
      const r = (await enviar('/api/kioscos', 'PATCH', { id: k.id, activo: !k.activo })) as Kiosco;
      setKioscos((ks) => ks.map((x) => (x.id === k.id ? r : x)));
      setMensaje({ tono: 'ok', texto: r.activo ? `«${r.nombre}» vuelve a funcionar.` : `«${r.nombre}» desactivada: deja de entrar y vuelve a pedir un código.` });
    } catch (error) {
      fallo(error);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="kio">
      {codigo && (
        <CodigoTablet
          codigo={codigo.codigo}
          urlEstado={codigo.revision ? undefined : `/api/kioscos/codigos?id=${codigo.codigo.id}`}
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
      {token && <TokenRecienEmitido datos={token} onListo={() => setToken(null)} />}

      <section className="kio-alta" aria-labelledby="kio-alta-titulo">
        <div className="kio-alta-cabecera">
          <h2 id="kio-alta-titulo">Añadir una tablet de Supricom</h2>
        </div>
        {!almacenes ? (
          <div className="notice error" style={{ margin: 0 }}>
            <p>Odoo no responde: no se puede elegir el almacén.</p>
          </div>
        ) : (
          <form className="kio-formulario" onSubmit={pedirCodigo}>
            <label>
              <span>Nombre de la tablet</span>
              <input className="input" name="nombre" required minLength={3} maxLength={100} placeholder="Tablet mostrador 1" />
            </label>
            <label>
              <span>Tienda</span>
              <input className="input" name="tienda" required minLength={2} maxLength={150} placeholder="Chacaíto, junto a caja" />
            </label>
            <SelectorAlmacen almacenes={almacenes} />
            <button className="btn btn-inline" type="submit" disabled={ocupado === 'codigo'}>
              {ocupado === 'codigo' ? 'Pidiendo…' : 'Añadir tablet'}
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
        {kioscos.length === 0 ? (
          <div className="table-wrap">
            <div className="empty">Todavía no hay ninguna tablet. Añade la primera arriba.</div>
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
                  <div className="kio-tablet-detalle">{dondeEsta(k)}</div>
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
                      {k.odooWarehouseId !== null && (
                        <button type="button" className="btn-link" disabled={ocupado === k.id || !k.activo} onClick={() => setConfirmar(k.id)}>
                          Token nuevo
                        </button>
                      )}
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

      <section className="kio-alta" aria-labelledby="kio-revision-titulo">
        <div className="kio-alta-cabecera">
          <h2 id="kio-revision-titulo">Código para los revisores de Apple y Google</h2>
        </div>
        <div className="kio-revision">
          <p className="kio-nota kio-espera">
            {revision
              ? `Vigente desde el ${new Date(revision.creadoEn).toLocaleDateString('es-VE')} · usado ${revision.usos} ${revision.usos === 1 ? 'vez' : 'veces'}`
              : 'Ninguno vigente'}
          </p>
          <div className="kio-tablet-acciones">
            {revision && (
              <button type="button" className="btn-link kio-peligro" disabled={ocupado === 'revision'} onClick={() => void revocarRevision()}>
                Revocar
              </button>
            )}
            <button type="button" className="btn btn-inline" disabled={ocupado === 'revision'} onClick={() => void nuevoCodigoRevision()}>
              {revision ? 'Crear otro (revoca el actual)' : 'Crear código'}
            </button>
          </div>
        </div>
      </section>

      <details className="kio-alta kio-mano">
        <summary>Preparar una tablet a mano</summary>
        {!almacenes ? (
          <div className="notice error" style={{ margin: 0 }}>
            <p>Odoo no responde: no se puede elegir el almacén.</p>
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
            <SelectorAlmacen almacenes={almacenes} />
            <button className="btn btn-inline" type="submit" disabled={ocupado === 'alta'}>
              {ocupado === 'alta' ? 'Registrando…' : 'Registrar y ver el token'}
            </button>
          </form>
        )}
      </details>
    </div>
  );
}

function SelectorAlmacen({ almacenes }: { almacenes: AlmacenKiosco[] }) {
  const porCompania = useMemo(() => {
    const m = new Map<string, AlmacenKiosco[]>();
    for (const a of almacenes) m.set(a.compania, [...(m.get(a.compania) ?? []), a]);
    return [...m.entries()];
  }, [almacenes]);

  return (
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
  );
}

function TokenRecienEmitido({ datos, onListo }: { datos: { kiosco: Kiosco; token: string; nuevo: boolean }; onListo: () => void }) {
  const [copiado, setCopiado] = useState(false);

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
        <strong>Cópialo ahora: no se vuelve a mostrar.</strong> Si se pierde, pide uno nuevo.
        {!datos.nuevo && ' El anterior ya no funciona.'}
      </p>
      <ol className="kio-pasos">
        <li>
          Pégalo en la configuración de la compilación: <code>ASTA_API_KEY</code> en <code>apps/ios/Config/Kiosco.xcconfig</code> o{' '}
          <code>asta.apiKey</code> en <code>apps/android/local.properties</code>.
        </li>
        <li>Compila e instala la aplicación en esa tablet. Entra directamente, sin pedir código.</li>
      </ol>
      <div className="kio-token-caja">
        <code id="kio-token">{datos.token}</code>
        <button type="button" className="btn btn-inline" onClick={() => void copiar()}>
          {copiado ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
      <div className="kio-token-pie">
        <button type="button" className="btn btn-inline" onClick={onListo}>
          Ya lo copié
        </button>
      </div>
    </section>
  );
}
