'use client';

import { useState } from 'react';
import { fechaCorta } from '@/lib/formato';

/**
 * Generación de enlaces de invitación (issue #16).
 *
 * Client Component porque el enlace hay que poder COPIARLO, y eso es
 * interacción de navegador. El resto del panel de administración es servidor.
 *
 * Con correo configurado (#53) la invitación sale sola; sin él, el
 * administrador copia el enlace y lo entrega por donde pueda. El aviso dice lo
 * que pasó DE VERDAD, según lo que contesta el middleware: nadie debe creer que
 * se envió un correo que no se envió.
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
  enviadoPorCorreo: boolean;
}

export function Invitaciones({
  candidatos,
  total,
  coincidencias,
  busqueda,
}: {
  candidatos: Candidato[];
  total: number;
  coincidencias: number;
  busqueda?: string;
}) {
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
      setGenerada({ url: body.data.url, expiraEl: body.data.expiraEl, email: c.email, enviadoPorCorreo: body.data.enviadoPorCorreo === true });
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
        entrar. Si el correo está configurado, la invitación les llega sola; si no, aquí se
        genera el enlace y <strong>lo entregas tú</strong>. Al invitar, el aviso dice cuál de las
        dos pasó.
      </p>

      {generada && (
        <div className="notice" style={{ marginBottom: 16, borderColor: 'var(--positive)' }}>
          <h2 style={{ color: 'var(--positive)' }}>
            {generada.enviadoPorCorreo ? `Invitación enviada por correo a ${generada.email}` : `Enlace para ${generada.email}`}
          </h2>
          <p style={{ marginBottom: 10 }}>
            {generada.enviadoPorCorreo ? (
              <>
                El enlace también está aquí por si el correo no llega. Caduca el {fechaCorta(generada.expiraEl)} y{' '}
                <strong>solo sirve una vez</strong>.
              </>
            ) : (
              <>
                <strong>No se ha enviado ningún correo.</strong> Cópialo y entrégalo tú. Caduca el{' '}
                {fechaCorta(generada.expiraEl)}, <strong>solo sirve una vez</strong> y no vuelve a mostrarse.
              </>
            )}
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

      {/*
        Los clientes se invitan cuando lo piden: hay que poder encontrar a ESE.
        Sin esto se veían los 25 primeros por orden alfabético de más de 2.000.
      */}
      <form className="filtros" method="get" action="/admin/usuarios" style={{ marginBottom: 14 }}>
        <div className="filtro-campo" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="q">Buscar</label>
          <input
            id="q"
            name="q"
            type="search"
            className="input"
            placeholder="Nombre, correo o número de cliente de Odoo"
            defaultValue={busqueda ?? ''}
            minLength={2}
          />
        </div>
        <button type="submit" className="btn btn-inline">
          Buscar
        </button>
        {busqueda && (
          <a href="/admin/usuarios" className="btn-link">
            Quitar búsqueda
          </a>
        )}
      </form>

      {busqueda && candidatos.length > 0 && (
        <p style={{ marginTop: -4, marginBottom: 12, fontSize: 13, color: 'var(--text-2)' }}>
          {coincidencias === 1 ? '1 coincide' : `${coincidencias.toLocaleString('es-VE')} coinciden`} con «{busqueda}»
          {coincidencias > candidatos.length ? `: se muestran las ${candidatos.length} primeras, afina la búsqueda.` : '.'}
        </p>
      )}

      {candidatos.length === 0 ? (
        <div className="empty" style={{ padding: '28px 20px' }}>
          {busqueda
            ? `Ninguna cuenta sin acceso coincide con «${busqueda}». Si es un cliente que ya entra, no aparece aquí.`
            : 'Todas las cuentas activas tienen acceso.'}
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
                      {/* Con correo sale sola; sin él, el aviso dice que se copie. */}
                      {generando === c.id ? 'Invitando…' : c.invitacionPendiente ? 'Reenviar' : 'Invitar'}
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
