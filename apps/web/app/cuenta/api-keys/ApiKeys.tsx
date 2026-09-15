'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  SCOPE_DESCRIPTION,
  WRITE_SCOPES,
  apiScopeSchema,
  type ApiKeySummary,
  type ApiScope,
} from '@asta/shared-types';
import { fechaCorta } from '@/lib/formato';

/**
 * Crear, listar y revocar API keys (issue #28).
 *
 * ── Las decisiones que no son de maquetación ─────────────────────────────────
 *
 * 1. **Ningún scope viene marcado.** El issue lo pide y la razón es que el
 *    valor por defecto es lo que elige casi todo el mundo: una casilla premarcada
 *    en `ORDERS_WRITE` sería que la mayoría de las keys puedan crear pedidos sin
 *    que nadie lo haya decidido. El botón de crear está deshabilitado hasta que
 *    se marque al menos uno.
 *
 * 2. **El token se enseña en un bloque que no se va solo.** Nada de un aviso
 *    temporal: es la única vez que ese valor existe. Se cierra a mano, y el
 *    botón dice que ya lo guardó.
 *
 * 3. **Las revocadas se listan, en gris y abajo.** Quien entra aquí suele venir
 *    de "¿qué tiene acceso a mis datos?", y esconder lo apagado no responde a
 *    eso: no deja ver que una integración se cerró ayer ni cuándo se usó por
 *    última vez.
 *
 * 4. **Revocar pide confirmación escribiendo el nombre.** Un `confirm()` se
 *    acepta por inercia. Aquí revocar apaga la integración de un cliente en
 *    producción y no se puede deshacer: la key no vuelve, hay que crear otra y
 *    cambiarla en su sistema.
 */

const TODOS: ApiScope[] = apiScopeSchema.options;

function esEscritura(s: ApiScope): boolean {
  return WRITE_SCOPES.includes(s);
}

function Etiqueta({ children, tono }: { children: React.ReactNode; tono?: 'aviso' | 'apagado' }) {
  const color =
    tono === 'aviso' ? '#8a5200' : tono === 'apagado' ? 'var(--muted, #6b7280)' : '#1f5c3d';
  const fondo = tono === 'aviso' ? '#fdf0d5' : tono === 'apagado' ? '#f1f2f4' : '#e6f4ec';
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        padding: '2px 7px',
        borderRadius: 10,
        background: fondo,
        color,
        marginRight: 5,
        marginTop: 3,
      }}
    >
      {children}
    </span>
  );
}

export function ApiKeys({
  filas,
  vivas,
  maximo,
}: {
  filas: ApiKeySummary[];
  vivas: number;
  maximo: number;
}) {
  const router = useRouter();

  const [creando, setCreando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [caduca, setCaduca] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);

  /** El token recién creado. Se muestra una vez; no hay forma de recuperarlo. */
  const [reciente, setReciente] = useState<{ nombre: string; token: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const [revocando, setRevocando] = useState<ApiKeySummary | null>(null);
  const [confirmacion, setConfirmacion] = useState('');

  const activas = filas.filter((k) => k.revokedAt === null);
  const revocadas = filas.filter((k) => k.revokedAt !== null);
  const sinHueco = vivas >= maximo;

  function alternar(s: ApiScope) {
    setScopes((antes) => (antes.includes(s) ? antes.filter((x) => x !== s) : [...antes, s]));
  }

  async function crear() {
    setEnviando(true);
    setFallo(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nombre.trim(),
          scopes,
          environment: 'LIVE',
          ...(caduca ? { expiresInDays: Number(caduca) } : {}),
        }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setFallo(body?.error?.message ?? 'No se pudo crear la key.');
        return;
      }

      setReciente({ nombre: nombre.trim(), token: body.data.plaintext });
      setCreando(false);
      setNombre('');
      setScopes([]);
      setCaduca('');
      router.refresh();
    } catch {
      setFallo('No se pudo contactar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  async function revocar() {
    if (!revocando) return;
    setEnviando(true);
    setFallo(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: revocando.id }),
      });

      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        setFallo(body?.error?.message ?? 'No se pudo revocar la key.');
        return;
      }

      setRevocando(null);
      setConfirmacion('');
      // `router.refresh()` en vez de quitar la fila a mano: si la revocación no
      // llegó a aplicarse, borrarla de la pantalla diría que una integración
      // está apagada cuando sigue funcionando.
      router.refresh();
    } catch {
      setFallo('No se pudo contactar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  async function copiar(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopiado(true);
    } catch {
      // Sin portapapeles —http sin TLS, o permiso denegado— el token sigue
      // visible y seleccionable. No se pierde nada.
      setCopiado(false);
    }
  }

  return (
    <section className="panel">
      {/* ── El token recién creado ────────────────────────────────────────── */}
      {reciente && (
        <div className="notice" style={{ marginBottom: 18, borderLeft: '3px solid #8a5200' }}>
          <h2 style={{ marginTop: 0 }}>Guarda este token ahora</h2>
          <p>
            Es la única vez que se muestra. No se guarda en ningún sitio del que
            podamos recuperarlo: si lo pierdes, hay que revocar
            «{reciente.nombre}» y crear otra.
          </p>
          <code
            style={{
              display: 'block',
              wordBreak: 'break-all',
              background: '#111',
              color: '#e8e8e8',
              padding: '10px 12px',
              borderRadius: 6,
              fontSize: 13,
              margin: '10px 0',
            }}
          >
            {reciente.token}
          </code>
          <button type="button" className="btn btn-inline" onClick={() => copiar(reciente.token)}>
            {copiado ? 'Copiado' : 'Copiar'}
          </button>{' '}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setReciente(null);
              setCopiado(false);
            }}
          >
            Ya lo guardé
          </button>
        </div>
      )}

      {fallo && (
        <div className="notice error" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0 }}>{fallo}</p>
        </div>
      )}

      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="sesiones-cabecera">
        <h2>
          {activas.length} {activas.length === 1 ? 'key activa' : 'keys activas'}
          {sinHueco && <span style={{ fontWeight: 400, fontSize: 13 }}> · máximo {maximo}</span>}
        </h2>

        {!creando && (
          <button
            type="button"
            className="btn btn-inline"
            onClick={() => setCreando(true)}
            disabled={sinHueco}
            title={sinHueco ? `Ya tienes ${maximo} activas. Revoca alguna.` : undefined}
          >
            Crear una key
          </button>
        )}
      </div>

      {/* ── Formulario ────────────────────────────────────────────────────── */}
      {creando && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Nueva API key</h2>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
              Nombre — para reconocerla después
            </span>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Integración con mi ERP"
              maxLength={60}
              style={{ width: '100%', maxWidth: 380, padding: '7px 9px' }}
            />
          </label>

          <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
            <legend style={{ fontSize: 13, marginBottom: 6, padding: 0 }}>
              Qué podrá hacer. Marca solo lo que necesite tu integración.
            </legend>

            {TODOS.map((s) => (
              <label key={s} style={{ display: 'block', marginBottom: 5, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => alternar(s)}
                  style={{ marginRight: 7 }}
                />
                {SCOPE_DESCRIPTION[s]}
                {esEscritura(s) && <Etiqueta tono="aviso">modifica datos</Etiqueta>}
              </label>
            ))}
          </fieldset>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
              Caducidad (opcional) — en días
            </span>
            <input
              type="number"
              min={1}
              max={730}
              value={caduca}
              onChange={(e) => setCaduca(e.target.value)}
              placeholder="sin caducidad"
              style={{ width: 140, padding: '7px 9px' }}
            />
          </label>

          <button
            type="button"
            className="btn btn-inline"
            onClick={crear}
            // Sin nombre o sin un solo scope no hay nada que crear. El servidor
            // lo rechaza igual; deshabilitarlo evita el viaje y el mensaje de
            // error por algo que se ve desde aquí.
            disabled={enviando || nombre.trim().length < 3 || scopes.length === 0}
          >
            {enviando ? 'Creando…' : 'Crear'}
          </button>{' '}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setCreando(false);
              setFallo(null);
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* ── Listado ───────────────────────────────────────────────────────── */}
      {filas.length === 0 && !creando && (
        <p style={{ fontSize: 14 }}>
          Todavía no tienes ninguna. Una API key permite que tu sistema consulte
          tus datos sin que nadie entre a este panel.
        </p>
      )}

      <ul className="sesiones">
        {[...activas, ...revocadas].map((k) => {
          const caducada = k.expiresAt !== null && Date.parse(k.expiresAt) < Date.now();
          const apagada = k.revokedAt !== null;

          return (
            <li key={k.id} className="sesion" style={apagada ? { opacity: 0.55 } : undefined}>
              <div className="sesion-datos">
                <div className="sesion-titulo">
                  {k.name}
                  {apagada && <Etiqueta tono="apagado">revocada</Etiqueta>}
                  {!apagada && caducada && <Etiqueta tono="aviso">caducada</Etiqueta>}
                  {k.environment === 'TEST' && <Etiqueta tono="apagado">pruebas</Etiqueta>}
                </div>

                <div className="sesion-meta">
                  <code>
                    asta_{k.environment.toLowerCase()}_{k.prefix}…{k.lastFour}
                  </code>
                  {' · '}
                  creada {fechaCorta(k.createdAt)}
                  {k.expiresAt && ` · caduca ${fechaCorta(k.expiresAt)}`}
                  {' · '}
                  {/* "nunca usada" importa: delata una integración que se
                      configuró y no llegó a arrancar. */}
                  {k.lastUsedAt
                    ? `último uso ${fechaCorta(k.lastUsedAt)} · ${k.usageCount} peticiones`
                    : 'nunca usada'}
                  {apagada && ` · revocada ${fechaCorta(k.revokedAt!)}`}
                </div>

                <div style={{ marginTop: 3 }}>
                  {k.scopes.map((s) => (
                    <Etiqueta key={s} tono={esEscritura(s) ? 'aviso' : undefined}>
                      {SCOPE_DESCRIPTION[s]}
                    </Etiqueta>
                  ))}
                </div>
              </div>

              {!apagada && (
                <button
                  type="button"
                  className="btn-link sesion-cerrar"
                  onClick={() => {
                    setRevocando(k);
                    setConfirmacion('');
                    setFallo(null);
                  }}
                >
                  Revocar
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── Confirmación de revocado ──────────────────────────────────────── */}
      {revocando && (
        <div className="notice error" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Revocar «{revocando.name}»</h2>
          <p>
            Deja de funcionar al instante y no se puede deshacer. Si algún
            sistema tuyo la está usando, dejará de recibir datos.
          </p>
          <label style={{ display: 'block', margin: '10px 0' }}>
            <span style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
              Escribe <strong>{revocando.name}</strong> para confirmar
            </span>
            <input
              type="text"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              style={{ width: '100%', maxWidth: 380, padding: '7px 9px' }}
            />
          </label>
          <button
            type="button"
            className="btn btn-inline btn-peligro"
            onClick={revocar}
            disabled={enviando || confirmacion !== revocando.name}
          >
            {enviando ? 'Revocando…' : 'Revocar'}
          </button>{' '}
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setRevocando(null);
              setConfirmacion('');
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      <p className="sesiones-pie">
        Trata una API key como una contraseña: quien la tenga puede consultar
        tus datos. No la pongas en el código de una web ni en un repositorio.
      </p>
    </section>
  );
}
