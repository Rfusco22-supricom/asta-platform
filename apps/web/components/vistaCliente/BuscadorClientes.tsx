'use client';

import { useMemo, useState } from 'react';

/** Busca entre los clientes con cuenta y lleva a su panel (ver `/api/vista-cliente`). */
export function BuscadorClientes({ clientes, destino }: { clientes: { id: number; nombre: string; nivel: string }[]; destino: string }) {
  const [q, setQ] = useState('');
  const encontrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? clientes.filter((c) => c.nombre.toLowerCase().includes(t) || String(c.id) === t) : clientes).slice(0, 30);
  }, [q, clientes]);
  const enlace = (c: { id: number; nombre: string }) => `/api/vista-cliente?id=${c.id}&nombre=${encodeURIComponent(c.nombre)}&a=${encodeURIComponent(destino)}`;

  return (
    <div className="vista-buscador">
      <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Busca entre ${clientes.length.toLocaleString('es-VE')} clientes con cuenta`} aria-label="Buscar cliente" />
      <ul>
        {encontrados.map((c) => (
          <li key={c.id}>
            <a href={enlace(c)}>
              <strong data-privado>{c.nombre}</strong>
              <span className="stat-sub">{c.nivel}</span>
            </a>
          </li>
        ))}
      </ul>
      {encontrados.length === 0 && <div className="empty">Ningún cliente con ese nombre.</div>}
    </div>
  );
}
