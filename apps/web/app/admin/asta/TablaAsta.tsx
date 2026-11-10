'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { OportunidadAsta } from '@asta/shared-types';
import { money, moneyEntero } from '@/lib/formato';
import { Avatar } from '@/components/Avatar';

/**
 * Los clientes y lo que compran de ASTA, del que más al que menos.
 *
 * Solo montos de ASTA (decidido con Supricom el 2026-11-10): lo que compran de
 * otras marcas no se enseña. «Nunca han comprado ASTA» son los que compran
 * consumibles y ninguno de ASTA: la primera prueba es la conversación más
 * fácil. Van en el orden del middleware, los que más compran primero.
 */

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
    // Sin ASTA: en el orden en que llegan (los que más compran, primero).
    // Todos: del que más ASTA compra al que menos.
    if (soloSinAsta) r = r.filter((o) => o.asta === 0 && o.competencia > 0);
    else r = [...r].sort((a, b) => b.asta - a.asta);
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
        <table className="tabla-tarjetas tabla-oportunidades">
          <thead>
            <tr>
              <th>Cliente</th>
              {conVendedor && <th>Vendedor</th>}
              <th className="num">Compra de ASTA</th>
            </tr>
          </thead>
          <tbody>
            {visibles.slice(0, 200).map((o) => (
              <tr key={o.partnerId}>
                <td className="c-cliente">
                  <div className="cliente-fila">
                    <Avatar nombre={o.nombre} tamano="s" />
                    <span className="cliente-datos">
                      <Link href={`/cartera/${o.partnerId}`} className="cliente-nombre enlace-ficha">
                        {o.nombre}
                      </Link>
                      <span className="cliente-contacto">Odoo #{o.partnerId}</span>
                    </span>
                  </div>
                </td>

                {conVendedor && (
                  <td className="c-vendedor" data-etiqueta="Vendedor" style={{ fontSize: 13 }}>
                    {o.vendedorNombre ?? <span style={{ color: 'var(--text-3)' }}>sin asignar</span>}
                  </td>
                )}

                <td className={`num c-asta${o.asta === 0 ? ' zero' : ''}`} data-etiqueta="Compra de ASTA" title={money(o.asta)}>
                  {o.asta === 0 ? 'Nunca ha comprado' : moneyEntero(o.asta)}
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
            Se muestran los 200 primeros de {visibles.length}. Usa el buscador para el resto.
          </div>
        )}
      </div>
    </>
  );
}
