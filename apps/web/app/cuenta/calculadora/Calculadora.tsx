'use client';

import { useMemo, useState } from 'react';
import { MARGEN_POR_DEFECTO } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * La calculadora de ganancia, solo con ASTA (decidido con Supricom el
 * 2026-11-10: ni marcas ni precios de otras marcas): con el margen que el
 * cliente le pone al ASTA, cuánto gana por unidad, al mes y al año, con los
 * precios de su tarifa.
 */

export interface ProductoCalculadora {
  productId: number;
  sku: string;
  nombre: string;
  /** Lo que le cuesta, con su tarifa, sin IVA. */
  precio: number;
  /** Lo que nos compra al mes (media de los 3 últimos meses completos). */
  compraMensual: number;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const sinMarca = (n: string) => n.replace(/^ASTA\s+/i, '');
const unidades = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 1 });

export function Calculadora({ productos }: { productos: ProductoCalculadora[] }) {
  const [elegido, setElegido] = useState(productos[0]?.productId ?? 0);
  const [filtro, setFiltro] = useState('');
  const [margen, setMargen] = useState(MARGEN_POR_DEFECTO);
  const [alMesPuesto, setAlMes] = useState<number | null>(null);

  const p = productos.find((x) => x.productId === elegido) ?? productos[0];
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return q ? productos.filter((x) => `${x.nombre} ${x.sku}`.toLowerCase().includes(q)) : productos;
  }, [filtro, productos]);
  // Lo que más le deja al mes de lo que ya compra; si no compra nada, lo que más deja por unidad.
  const ranking = useMemo(() => {
    const compra = productos.filter((x) => x.compraMensual > 0);
    const base = compra.length ? compra : productos;
    return [...base].sort((a, b) => b.precio * margen * (b.compraMensual || 1) - a.precio * margen * (a.compraMensual || 1)).slice(0, 10);
  }, [productos, margen]);

  if (!p) {
    return (
      <section className="panel">
        <h2>Calculadora de ganancia</h2>
        <div className="empty">Tu tarifa todavía no tiene precio para ningún producto ASTA. Pregúntale a tu vendedor.</div>
      </section>
    );
  }

  const venta = p.precio * (1 + margen);
  const ganancia = venta - p.precio;
  const alMes = alMesPuesto ?? (Math.round(p.compraMensual) || 10);
  const elegir = (id: number) => {
    setElegido(id);
    setAlMes(null);
  };

  return (
    <>
      <section className="panel calc">
        <div className="calc-controles">
          <label className="calc-campo">
            <span className="calc-etiqueta">Producto ASTA</span>
            <input className="input" value={filtro} placeholder="Busca por nombre o código" onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar producto" />
            <select className="select" value={p.productId} onChange={(e) => elegir(Number(e.target.value))} aria-label="Producto" size={5}>
              {visibles.map((x) => (
                <option key={x.productId} value={x.productId}>
                  {x.compraMensual > 0 ? '★ ' : ''}
                  {sinMarca(x.nombre)} · {x.sku}
                </option>
              ))}
            </select>
            <span className="stat-sub">★ los que ya nos compras</span>
          </label>
          <label className="calc-campo">
            <span className="calc-etiqueta">
              Tu margen <b>{pct(margen)}</b>
            </span>
            <input type="range" min={0} max={100} step={1} value={Math.round(margen * 100)} onChange={(e) => setMargen(Number(e.target.value) / 100)} aria-label="Tu margen" />
            <span className="stat-sub">Lo que le sumas a lo que te cuesta para venderlo.</span>
          </label>
          <label className="calc-campo">
            <span className="calc-etiqueta">Unidades al mes</span>
            <input className="input" type="number" min={0} max={100000} value={alMes} onChange={(e) => setAlMes(Math.max(0, Number(e.target.value) || 0))} aria-label="Unidades al mes" />
            <span className="stat-sub">{p.compraMensual > 0 ? `Nos compras unas ${unidades(p.compraMensual)} al mes.` : 'Pon las que crees que vendes al mes.'}</span>
          </label>
        </div>

        <div className="calc-resultado">
          <div className="calc-comparacion">
            <div className="calc-columna calc-asta">
              <span className="calc-marca">ASTA</span>
              <strong>{p.sku}</strong>
              <dl>
                <dt>Te cuesta</dt>
                <dd>{money(p.precio)}</dd>
                <dt>Lo vendes a</dt>
                <dd>{money(venta)}</dd>
                <dt>Ganas</dt>
                <dd>{money(ganancia)}</dd>
              </dl>
            </div>
          </div>
          <div className="calc-titulares">
            <p>
              <span>Ganas</span>
              <b>{money(ganancia)}</b>
              <span>por unidad</span>
            </p>
            <p className="calc-mes">
              <span>Con {alMes.toLocaleString('es-VE')} al mes</span>
              <b>{money(ganancia * alMes)}</b>
              <span>al mes · {money(ganancia * alMes * 12)} al año</span>
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Lo que más te deja ASTA al mes</h2>
        <p className="panel-nota">Con tu margen del {pct(margen)}{productos.some((x) => x.compraMensual > 0) ? ' y lo que nos compras al mes' : ''}. Toca una fila para verla arriba.</p>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Producto ASTA</th>
                <th className="num">Te cuesta</th>
                <th className="num">Ganas por unidad</th>
                <th className="num">Al mes</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((x) => (
                <tr key={x.productId} className={x.productId === p.productId ? 'calc-fila-activa' : undefined} onClick={() => elegir(x.productId)} style={{ cursor: 'pointer' }}>
                  <td>
                    {sinMarca(x.nombre)}
                    <div className="sku">{x.sku}</div>
                  </td>
                  <td className="num">{money(x.precio)}</td>
                  <td className="num">
                    <strong>{money(x.precio * margen)}</strong>
                  </td>
                  <td className="num">{x.compraMensual > 0 ? `${money(x.precio * margen * x.compraMensual)} · ${unidades(x.compraMensual)} u.` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
