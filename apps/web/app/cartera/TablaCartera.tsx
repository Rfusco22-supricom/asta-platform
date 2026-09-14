'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PortfolioRow } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * Tabla de cartera.
 *
 * Es Client Component porque ordenar y filtrar tiene que ser instantáneo: con
 * 791 filas ya cargadas, ir al servidor por cada clic sería absurdo. Los datos
 * llegan del Server Component de arriba; aquí solo se reordenan.
 */

type Columna = 'nombre' | 'totalFacturado' | 'porCobrar' | 'numeroFacturas';
type Filtro = 'todos' | 'clientes' | 'prospectos' | 'deuda';

const TIER_CLASS: Record<string, string> = {
  BRONCE: 'bronce',
  PLATA: 'plata',
  GOLD: 'gold',
};

export function TablaCartera({ filas }: { filas: PortfolioRow[] }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [orden, setOrden] = useState<Columna>('totalFacturado');
  const [desc, setDesc] = useState(true);

  const visibles = useMemo(() => {
    // Se normaliza sin acentos: nadie escribe "PAPELERÍA" con tilde al buscar.
    const q = busqueda
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    let out = filas;

    if (q) {
      out = out.filter((f) => {
        const heno = `${f.nombre} ${f.email ?? ''} ${f.telefono ?? ''}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '');
        return heno.includes(q);
      });
    }

    if (filtro === 'clientes') out = out.filter((f) => f.esCliente);
    else if (filtro === 'prospectos') out = out.filter((f) => !f.esCliente);
    else if (filtro === 'deuda') out = out.filter((f) => f.porCobrar > 0);

    return [...out].sort((a, b) => {
      const signo = desc ? -1 : 1;
      if (orden === 'nombre') return signo * a.nombre.localeCompare(b.nombre, 'es');
      return signo * (a[orden] - b[orden]);
    });
  }, [filas, busqueda, filtro, orden, desc]);

  function ordenarPor(col: Columna) {
    if (col === orden) setDesc(!desc);
    else {
      setOrden(col);
      // El nombre se lee de la A a la Z; los números interesan de mayor a menor.
      setDesc(col !== 'nombre');
    }
  }

  const flecha = (col: Columna) =>
    col === orden ? <span className="arrow">{desc ? '↓' : '↑'}</span> : null;

  return (
    <>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Buscar por nombre, correo o teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar en la cartera"
        />

        <div className="segmented" role="group" aria-label="Filtrar cartera">
          {(
            [
              ['todos', 'Todos'],
              ['clientes', 'Con historial'],
              ['prospectos', 'Prospectos'],
              ['deuda', 'Con deuda'],
            ] as const
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={filtro === valor}
              onClick={() => setFiltro(valor)}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <span className="count">
          {visibles.length === filas.length
            ? `${filas.length} clientes`
            : `${visibles.length} de ${filas.length}`}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => ordenarPor('nombre')}>
                Cliente {flecha('nombre')}
              </th>
              <th className="col-nivel">Nivel</th>
              <th className="sortable num" onClick={() => ordenarPor('totalFacturado')}>
                Facturado {flecha('totalFacturado')}
              </th>
              <th className="sortable num" onClick={() => ordenarPor('porCobrar')}>
                Por cobrar {flecha('porCobrar')}
              </th>
              <th className="sortable num" onClick={() => ordenarPor('numeroFacturas')}>
                Facturas {flecha('numeroFacturas')}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id} className="linked">
                <td>
                  {/* El enlace envuelve el contenido y no la fila: un <a> no
                      puede contener <td>, y hacerlo con onClick rompería
                      abrir en pestaña nueva con ctrl+clic. */}
                  <Link href={`/cartera/${f.id}`} className="row-link">
                    <div className="cliente-nombre">
                      {f.nombre}
                      {/*
                        Marca de prospecto para cuando la columna «Nivel» no
                        cabe (pantalla estrecha).

                        Se pinta SIEMPRE y es el CSS quien decide si se ve. Con
                        JavaScript mirando el ancho de la ventana, el servidor y
                        el navegador renderizarían cosas distintas y la
                        hidratación fallaría — el mismo fallo que hubo en la
                        pantalla de sesiones.

                        Solo se conserva «Prospecto», no el nivel: hoy los 2942
                        clientes están en la misma tarifa (#5), así que el nivel
                        no distingue a nadie. Que un cliente no haya comprado
                        nunca, sí.
                      */}
                      {!f.esCliente && <span className="marca-prospecto">Prospecto</span>}
                    </div>
                    {(f.email || f.telefono) && (
                      <div className="cliente-contacto">
                        {[f.email, f.telefono].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </Link>
                </td>
                <td className="col-nivel">
                  {f.esCliente ? (
                    <span className={`tag ${TIER_CLASS[f.tierDerivado] ?? 'bronce'}`}>
                      {f.tierDerivado}
                    </span>
                  ) : (
                    <span className="tag prospecto">Prospecto</span>
                  )}
                </td>
                <td className={`num ${f.totalFacturado === 0 ? 'zero' : ''}`}>
                  {f.totalFacturado === 0 ? '—' : money(f.totalFacturado)}
                </td>
                <td className={`num ${f.porCobrar > 0 ? 'debt' : 'zero'}`}>
                  {f.porCobrar === 0 ? '—' : money(f.porCobrar)}
                </td>
                <td className={`num ${f.numeroFacturas === 0 ? 'zero' : ''}`}>
                  {f.numeroFacturas === 0 ? '—' : f.numeroFacturas}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visibles.length === 0 && (
          <div className="empty">
            {busqueda
              ? `Ningún cliente coincide con "${busqueda}".`
              : 'No hay clientes que mostrar con este filtro.'}
          </div>
        )}
      </div>
    </>
  );
}
