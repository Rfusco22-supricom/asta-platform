'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import type { PersonaConAcceso } from '@/lib/api';

/**
 * Accesos → Personal: quién del equipo entra al panel y con qué rol.
 *
 * Solo usuarios internos de Odoo, que entran con su usuario y contraseña de
 * Odoo. Los clientes no se gestionan aquí: entran como clientes, por su lado.
 *
 * Client Component porque busca mientras se escribe y los botones actúan sin
 * recargar. Los clics van al puente `/api/personal`, nunca al middleware: el
 * navegador no tiene el token de sesión.
 */

type Rol = 'SUPERADMIN' | 'VENDEDOR';
const NOMBRE_ROL: Record<Rol, string> = { SUPERADMIN: 'Administrador', VENDEDOR: 'Vendedor' };

interface UsuarioOdoo {
  odooUserId: number;
  nombre: string;
  login: string;
  rol: Rol | null;
}

async function llamar(ruta: string, init: RequestInit): Promise<{ ok: true; data: unknown } | { ok: false; mensaje: string }> {
  try {
    const res = await fetch(ruta, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, mensaje: body?.error?.message ?? 'No se pudo completar.' };
    return { ok: true, data: body?.data };
  } catch {
    return { ok: false, mensaje: 'No se pudo contactar con el servidor.' };
  }
}

export function Personal({ conAcceso, yo }: { conAcceso: PersonaConAcceso[]; yo: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'bien' | 'error'; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);

  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<UsuarioOdoo[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [rolNuevo, setRolNuevo] = useState<Record<number, Rol>>({});

  // Busca al dejar de escribir, no en cada tecla: cada búsqueda es una consulta a Odoo.
  useEffect(() => {
    const termino = q.trim();
    if (termino.length < 2) {
      setResultados(null);
      return;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await llamar(`/api/personal?${new URLSearchParams({ q: termino })}`, { method: 'GET' });
      if (!vigente) return;
      setBuscando(false);
      if (r.ok) setResultados(r.data as UsuarioOdoo[]);
      else setAviso({ tipo: 'error', texto: r.mensaje });
    }, 350);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q]);

  async function darAcceso(odooUserId: number, nombre: string, rol: Rol) {
    setOcupado(odooUserId);
    setAviso(null);
    const r = await llamar(`/api/personal/${odooUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol }),
    });
    setOcupado(null);
    if (!r.ok) {
      setAviso({ tipo: 'error', texto: r.mensaje });
      return;
    }
    setAviso({ tipo: 'bien', texto: `${nombre} entra ahora como ${NOMBRE_ROL[rol]}, con su usuario y contraseña de Odoo.` });
    setResultados((rs) => rs?.map((u) => (u.odooUserId === odooUserId ? { ...u, rol } : u)) ?? rs);
    router.refresh();
  }

  async function quitar(odooUserId: number, nombre: string) {
    setOcupado(odooUserId);
    setAviso(null);
    setConfirmando(null);
    const r = await llamar(`/api/personal/${odooUserId}`, { method: 'DELETE' });
    setOcupado(null);
    if (!r.ok) {
      setAviso({ tipo: 'error', texto: r.mensaje });
      return;
    }
    setAviso({ tipo: 'bien', texto: `${nombre} ya no tiene acceso al panel. Sus sesiones abiertas se cerraron.` });
    setResultados((rs) => rs?.map((u) => (u.odooUserId === odooUserId ? { ...u, rol: null } : u)) ?? rs);
    router.refresh();
  }

  return (
    <>
      {aviso && (
        <div className={`notice${aviso.tipo === 'error' ? ' error' : ''}`} style={{ marginBottom: 16, ...(aviso.tipo === 'bien' ? { borderColor: 'var(--positive)' } : {}) }}>
          <p style={{ margin: 0 }}>{aviso.texto}</p>
        </div>
      )}

      <section className="panel">
        <h2>Con acceso al panel</h2>
        <p style={{ marginTop: -6, marginBottom: 14, fontSize: 13.5, color: 'var(--text-2)' }}>
          <strong>{conAcceso.length}</strong> personas del equipo. Entran con su usuario y contraseña de Odoo. El
          <strong> administrador</strong> lo ve y lo gestiona todo; el <strong>vendedor</strong>, su cartera.
        </p>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Persona</th>
                <th style={{ width: 170 }}>Rol</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {conAcceso.map((p) => {
                const soyYo = p.appUserId === yo;
                const local = p.odooUserId === null;
                const id = p.odooUserId ?? -1;
                return (
                  <tr key={p.appUserId}>
                    <td>
                      <div className="cliente-fila">
                        <Avatar nombre={p.nombre} tamano="s" />
                        <span className="cliente-datos">
                          <span className="cliente-nombre">
                            {p.nombre}
                            {soyYo ? ' (tú)' : ''}
                          </span>
                          <span className="cliente-contacto">{p.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {soyYo || local ? (
                        <span className="tag">{NOMBRE_ROL[p.rol]}</span>
                      ) : (
                        <select
                          className="input"
                          aria-label={`Rol de ${p.nombre}`}
                          value={p.rol}
                          disabled={ocupado === id}
                          onChange={(e) => darAcceso(id, p.nombre, e.target.value as Rol)}
                        >
                          <option value="SUPERADMIN">Administrador</option>
                          <option value="VENDEDOR">Vendedor</option>
                        </select>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {local ? (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }} title="Sin usuario de Odoo: no se gestiona desde aquí">
                          Cuenta local
                        </span>
                      ) : soyYo ? null : confirmando === id ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <button type="button" className="btn btn-inline btn-peligro" disabled={ocupado === id} onClick={() => quitar(id, p.nombre)}>
                            {ocupado === id ? 'Quitando…' : 'Sí, quitar'}
                          </button>
                          <button type="button" className="btn-link" onClick={() => setConfirmando(null)}>
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn-link" onClick={() => setConfirmando(id)}>
                          Quitar acceso
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Dar acceso a alguien del equipo</h2>
        <div className="filtros" style={{ marginBottom: 14 }}>
          <div className="filtro-campo" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="buscar-personal">Buscar en los usuarios de Odoo</label>
            <input
              id="buscar-personal"
              type="search"
              className="input"
              placeholder="Nombre o usuario de Odoo"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        {q.trim().length < 2 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
            Escribe al menos dos letras. Salen solo usuarios internos y activos de Odoo: los clientes entran por su lado.
          </p>
        ) : buscando && !resultados ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>Buscando en Odoo…</p>
        ) : resultados && resultados.length === 0 ? (
          <div className="empty" style={{ padding: '28px 20px' }}>
            Ningún usuario interno y activo de Odoo coincide con «{q.trim()}».
          </div>
        ) : resultados ? (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Usuario de Odoo</th>
                  <th style={{ width: 170 }}>Acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resultados.map((u) => (
                  <tr key={u.odooUserId}>
                    <td>
                      <div className="cliente-fila">
                        <Avatar nombre={u.nombre} tamano="s" />
                        <span className="cliente-datos">
                          <span className="cliente-nombre">{u.nombre}</span>
                          <span className="cliente-contacto">{u.login}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {u.rol ? (
                        <span className="tag">{NOMBRE_ROL[u.rol]}</span>
                      ) : (
                        <select
                          className="input"
                          aria-label={`Rol para ${u.nombre}`}
                          value={rolNuevo[u.odooUserId] ?? 'VENDEDOR'}
                          onChange={(e) => setRolNuevo((r) => ({ ...r, [u.odooUserId]: e.target.value as Rol }))}
                        >
                          <option value="VENDEDOR">Vendedor</option>
                          <option value="SUPERADMIN">Administrador</option>
                        </select>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {u.rol ? (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Ya tiene acceso</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-inline"
                          disabled={ocupado === u.odooUserId}
                          onClick={() => darAcceso(u.odooUserId, u.nombre, rolNuevo[u.odooUserId] ?? 'VENDEDOR')}
                        >
                          {ocupado === u.odooUserId ? 'Dando acceso…' : 'Dar acceso'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
