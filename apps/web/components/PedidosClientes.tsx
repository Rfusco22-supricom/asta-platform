'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PedidoCliente } from '@asta/shared-types';
import { fecha, money } from '@/lib/formato';

/**
 * Los pedidos sugeridos que envían los clientes, por atender. No están en Odoo:
 * el vendedor los pasa a Odoo como cotización y los marca aquí («Pasado a
 * Odoo», con el folio si lo tiene) o los descarta con el motivo, que el cliente
 * ve en su pantalla. Administración ve todos; el vendedor, los de su cartera.
 */

const n = (x: number) => x.toLocaleString('es-VE');

function Atender({ pedido, alTerminar }: { pedido: PedidoCliente; alTerminar: (id: string) => void }) {
  const [modo, setModo] = useState<'odoo' | 'descartar' | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setOcupado(true);
    setError(null);
    try {
      const cuerpo = modo === 'odoo' ? { estado: 'EN_ODOO', folioOdoo: texto.trim() || undefined } : { estado: 'DESCARTADO', motivo: texto.trim() };
      const res = await fetch(`/api/pedidos-clientes/${pedido.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? 'No se pudo guardar.');
        return;
      }
      alTerminar(pedido.id);
    } catch {
      setError('No hay conexión. Prueba otra vez.');
    } finally {
      setOcupado(false);
    }
  }

  if (modo === null) {
    return (
      <div className="pedido-atender">
        <button type="button" className="btn btn-inline" onClick={() => setModo('odoo')}>
          Pasado a Odoo
        </button>
        <button type="button" className="btn-link" onClick={() => setModo('descartar')}>
          Descartar
        </button>
      </div>
    );
  }
  return (
    <div className="pedido-atender">
      <input
        autoFocus
        value={texto}
        maxLength={modo === 'odoo' ? 64 : 300}
        disabled={ocupado}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={modo === 'odoo' ? 'Folio de la cotización en Odoo (opcional)' : 'Motivo (lo ve el cliente)'}
        aria-label={modo === 'odoo' ? 'Folio de la cotización en Odoo' : 'Motivo del descarte'}
      />
      <button type="button" className="btn btn-inline" disabled={ocupado || (modo === 'descartar' && !texto.trim())} onClick={() => void guardar()}>
        {ocupado ? 'Guardando…' : modo === 'odoo' ? 'Marcar como pasado' : 'Descartar'}
      </button>
      <button type="button" className="btn-link" disabled={ocupado} onClick={() => (setModo(null), setTexto(''), setError(null))}>
        Cancelar
      </button>
      {error && (
        <span className="so-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function PedidosClientes({ inicial }: { inicial: PedidoCliente[] }) {
  const router = useRouter();
  const [pedidos, setPedidos] = useState(inicial);
  if (pedidos.length === 0) return null;

  const terminar = (id: string) => {
    setPedidos((ps) => ps.filter((p) => p.id !== id));
    router.refresh();
  };

  return (
    <section className="panel pedidos-clientes" aria-labelledby="pedidos-clientes-titulo">
      <h2 id="pedidos-clientes-titulo">
        Pedidos de clientes <span className="pi-cuenta">{pedidos.length}</span>
      </h2>
      <p className="stat-sub" style={{ margin: 0 }}>
        Los enviaron desde su pedido sugerido. Pásalos a Odoo como cotización y márcalos aquí; el cliente ve en qué quedó.
      </p>
      <ul>
        {pedidos.map((p) => (
          <li key={p.id} className="pedido-cliente">
            <div className="pedido-cliente-cabeza">
              <Link href={`/cartera/${p.partnerId}`} className="cliente-nombre enlace-ficha">
                <strong>{p.cliente}</strong>
              </Link>
              <span className="stat-sub">
                {fecha(p.enviadoEn.slice(0, 10))} · {p.lineas.length} {p.lineas.length === 1 ? 'producto' : 'productos'}, {n(p.unidades)} u.
                {p.importeEstimado !== null && ` · ${money(p.importeEstimado)} sin IVA`}
              </span>
            </div>
            {p.nota && <p className="stat-sub" style={{ margin: 0 }}>«{p.nota}»</p>}
            <details>
              <summary>Ver productos</summary>
              <div className="table-wrap" style={{ border: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="num">Pide</th>
                      <th className="num">Sugerido</th>
                      <th className="num">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lineas.map((l) => (
                      <tr key={l.productId}>
                        <td>
                          {l.nombre.replace(/^ASTA\s+/i, '')}
                          {l.sku && <div className="sku">{l.sku}</div>}
                        </td>
                        <td className="num">{n(l.cantidad)}</td>
                        <td className="num">{l.sugeridas === null ? '—' : n(l.sugeridas)}</td>
                        <td className="num">{l.precio === null ? '—' : money(l.precio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <Atender pedido={p} alTerminar={terminar} />
          </li>
        ))}
      </ul>
    </section>
  );
}
