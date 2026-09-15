'use client';

import { useMemo, useState } from 'react';
import type { OportunidadAsta } from '@asta/shared-types';
import { money, moneyCompact } from '@/lib/formato';

/**
 * Lista de oportunidades: quién compra consumibles de otra marca y cuánto.
 *
 * ── Por qué ordena por lo de la COMPETENCIA ──────────────────────────────────
 *
 * Porque la pregunta es dónde hay más que ganar, y eso es el importe que hoy se
 * va a otra marca. Ordenar por el total del cliente pondría arriba a los que ya
 * compran ASTA casi todo, que no son una oportunidad: son clientes atendidos.
 *
 * ── La barra de cuota ────────────────────────────────────────────────────────
 *
 * Es el único adorno de la tabla y se gana el sitio: el porcentaje solo se lee
 * fila a fila, y la barra deja ver de un vistazo dónde está el hueco. No lleva
 * color por «bueno» o «malo» — un 0 % en un cliente de 900 importa mucho menos
 * que un 20 % en uno de 90.000, y pintarlos igual de rojos sería mentir.
 */

function Cuota({ pct }: { pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <div
        style={{
          width: 54,
          height: 6,
          borderRadius: 999,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          flex: 'none',
        }}
        aria-hidden="true"
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--primario-claro), var(--primario))',
          }}
        />
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
        {pct.toFixed(0)} %
      </span>
    </div>
  );
}

export function TablaAsta({
  filas,
  conVendedor,
}: {
  filas: OportunidadAsta[];
  /** El administrador ve de quién es cada cliente; el vendedor no lo necesita. */
  conVendedor: boolean;
}) {
  const [busca, setBusca] = useState('');
  const [soloSinAsta, setSoloSinAsta] = useState(false);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let r = filas;
    if (q) {
      r = r.filter(
        (o) =>
          o.nombre.toLowerCase().includes(q) ||
          (o.vendedorNombre ?? '').toLowerCase().includes(q),
      );
    }
    // «Nunca han comprado ASTA» es la conversación más fácil de tener: no hay que
    // convencer de cambiar, hay que conseguir la primera prueba.
    if (soloSinAsta) r = r.filter((o) => o.asta === 0 && o.competencia > 0);
    return r;
  }, [filas, busca, soloSinAsta]);

  const sinAsta = filas.filter((o) => o.asta === 0 && o.competencia > 0).length;

  return (
    <>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder={conVendedor ? 'Buscar por cliente o vendedor…' : 'Buscar por cliente…'}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        {sinAsta > 0 && (
          <div className="segmented">
            <button type="button" aria-pressed={!soloSinAsta} onClick={() => setSoloSinAsta(false)}>
              Todos
            </button>
            <button type="button" aria-pressed={soloSinAsta} onClick={() => setSoloSinAsta(true)}>
              Nunca han comprado ASTA ({sinAsta})
            </button>
          </div>
        )}

        <span className="count">
          {visibles.length} de {filas.length}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              {conVendedor && <th>Vendedor</th>}
              <th className="num">A la competencia</th>
              <th className="num">En ASTA</th>
              <th className="num">Cuota ASTA</th>
            </tr>
          </thead>
          <tbody>
            {visibles.slice(0, 200).map((o) => (
              <tr key={o.partnerId}>
                <td>
                  <div className="cliente-nombre">{o.nombre}</div>
                  <div className="cliente-contacto">partner {o.partnerId}</div>
                </td>

                {conVendedor && (
                  <td style={{ fontSize: 13 }}>
                    {o.vendedorNombre ?? <span style={{ color: 'var(--text-3)' }}>sin asignar</span>}
                  </td>
                )}

                <td className="num" title={money(o.competencia)}>
                  {moneyCompact(o.competencia)}
                </td>

                <td className={o.asta === 0 ? 'num zero' : 'num'} title={money(o.asta)}>
                  {o.asta === 0 ? '—' : moneyCompact(o.asta)}
                </td>

                <td className="num">
                  <Cuota pct={o.cuota} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visibles.length === 0 && <div className="empty">Ningún cliente coincide.</div>}

        {/*
          Tope de 200 filas pintadas.
          Con 1.248 clientes, el navegador tarda en dibujar la tabla entera y
          nadie baja hasta el final de una lista ordenada por oportunidad. Se
          dice que hay más en vez de cortar en silencio.
        */}
        {visibles.length > 200 && (
          <div className="empty">
            Se muestran las 200 mayores de {visibles.length}. Usa el buscador para el resto.
          </div>
        )}
      </div>
    </>
  );
}
