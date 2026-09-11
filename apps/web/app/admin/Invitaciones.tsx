'use client';

import { useState } from 'react';

/**
 * Generación de enlaces de invitación (issue #16).
 *
 * Client Component porque el enlace hay que poder COPIARLO, y eso es
 * interacción de navegador. El resto del panel de administración es servidor.
 *
 * Mientras no haya SMTP, el administrador copia el enlace y lo entrega por
 * donde pueda. El texto lo dice sin adornos: nadie debe creer que se envió un
 * correo que no se envió.
 */

interface Candidato {
  id: string;
  email: string;
  nombre: string;
  role: string;
  invitacionPendiente: boolean;
}

interface Generada {
  url: string;
  expiraEl: string;
  email: string;
}

export function Invitaciones({ candidatos, total }: { candidatos: Candidato[]; total: number }) {
  const [generando, setGenerando] = useState<string | null>(null);
  const [generada, setGenerada] = useState<Generada | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function invitar(c: Candidato) {
    setGenerando(c.id);
    setFallo(null);
    setCopiado(false);
    try {
      const res = await fetch(`/api/invitar/${c.id}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFallo(body?.error?.message ?? 'No se pudo generar el enlace.');
        return;
      }
      setGenerada({ url: body.data.url, expiraEl: body.data.expiraEl, email: c.email });
    } catch {
      setFallo('No se pudo contactar con el servidor.');
    } finally {
      setGenerando(null);
    }
  }

  async function copiar() {
    if (!generada) return;
    try {
      await navigator.clipboard.writeText(generada.url);
      setCopiado(true);
    } catch {
      // El portapapeles falla sin HTTPS o sin permiso. El enlace está visible en
      // pantalla, así que siempre se puede seleccionar a mano.
      setFallo('No se pudo copiar automáticamente. Selecciona el enlace y cópialo.');
    }
  }

  return (
    <section className="panel">
      <h2>Invitar a un usuario</h2>

      <p style={{ marginTop: -6, marginBottom: 14, fontSize: 13.5, color: 'var(--text-2)' }}>
        <strong>{total.toLocaleString('es-VE')}</strong> cuentas activas todavía no pueden
        entrar. Sin correo configurado, aquí se genera el enlace y{' '}
        <strong>lo entregas tú</strong> — no se envía nada automáticamente.
      </p>

      {generada && (
        <div className="notice" style={{ marginBottom: 16, borderColor: 'var(--positive)' }}>
          <h2 style={{ color: 'var(--positive)' }}>Enlace para {generada.email}</h2>
          <p style={{ marginBottom: 10 }}>
            Caduca el {new Date(generada.expiraEl).toLocaleDateString('es-VE')} y{' '}
            <strong>solo sirve una vez</strong>. No vuelve a mostrarse: cópialo ahora.
          </p>
          <div className="enlace-copiable">
            <code>{generada.url}</code>
            <button type="button" className="btn btn-inline" onClick={copiar}>
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {fallo && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0 }}>{fallo}</p>
        </div>
      )}

      {candidatos.length === 0 ? (
        <div className="empty" style={{ padding: '28px 20px' }}>
          Todas las cuentas activas tienen acceso.
        </div>
      ) : (
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th style={{ width: 160 }} />
              </tr>
            </thead>
            <tbody>
              {candidatos.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cliente-nombre">{c.nombre}</div>
                    <div className="cliente-contacto">{c.email}</div>
                  </td>
                  <td>
                    <span className="tag prospecto">{c.role}</span>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-inline"
                      onClick={() => invitar(c)}
                      disabled={generando === c.id}
                    >
                      {generando === c.id
                        ? 'Generando…'
                        : c.invitacionPendiente
                          ? 'Regenerar'
                          : 'Generar enlace'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
        Regenerar invalida el enlace anterior. Esto sirve para dar de alta a unos pocos
        clientes a mano; para los {total.toLocaleString('es-VE')} hace falta SMTP (issue #53).
      </p>
    </section>
  );
}
