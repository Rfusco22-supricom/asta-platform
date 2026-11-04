'use client';

import { useMemo, useState } from 'react';
import { DESCUENTO_POR_DEFECTO, MARGEN_POR_DEFECTO, calcularGanancia, type Calculadora as Datos, type ParejaCalculadora } from '@asta/shared-types';
import { money } from '@/lib/formato';

/**
 * La calculadora de ganancia: con el margen que el cliente gana en el original
 * y el descuento que le daría a su comprador con ASTA, cuánto gana de más por
 * unidad y al mes. La cuenta está en `calcularGanancia` (shared-types).
 */

const pct = (x: number) => `${Math.round(x * 100)} %`;
const sinMarca = (n: string) => n.replace(/^ASTA\s+/i, '');
const clave = (p: ParejaCalculadora) => `${p.asta.productId}:${p.original.productId}`;

function Porcentaje({ etiqueta, valor, max, alCambiar, ayuda }: { etiqueta: string; valor: number; max: number; alCambiar: (v: number) => void; ayuda: string }) {
  return (
    <label className="calc-campo">
      <span className="calc-etiqueta">
        {etiqueta} <b>{pct(valor)}</b>
      </span>
      <input type="range" min={0} max={max} step={1} value={Math.round(valor * 100)} onChange={(e) => alCambiar(Number(e.target.value) / 100)} aria-label={etiqueta} />
      <span className="stat-sub">{ayuda}</span>
    </label>
  );
}

export function Calculadora({ datos }: { datos: Datos }) {
  const [elegida, setElegida] = useState(datos.parejas[0] ? clave(datos.parejas[0]) : '');
  const [filtro, setFiltro] = useState('');
  const [margen, setMargen] = useState(MARGEN_POR_DEFECTO);
  const [descuento, setDescuento] = useState(DESCUENTO_POR_DEFECTO);
  const [unidades, setUnidades] = useState<number | null>(null);

  const pareja = datos.parejas.find((p) => clave(p) === elegida) ?? datos.parejas[0];
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return q ? datos.parejas.filter((p) => `${p.asta.nombre} ${p.asta.sku} ${p.original.nombre} ${p.original.sku} ${p.original.marca ?? ''}`.toLowerCase().includes(q)) : datos.parejas;
  }, [filtro, datos.parejas]);
  const ranking = useMemo(
    () => [...datos.parejas].map((p) => ({ p, c: calcularGanancia(p, margen, descuento) })).sort((a, b) => b.c.gananciaExtra - a.c.gananciaExtra).slice(0, 10),
    [datos.parejas, margen, descuento],
  );

  if (!pareja) {
    return (
      <section className="panel">
        <h2>Calculadora de ganancia</h2>
        <div className="empty">Tu tarifa todavía no tiene precio para ningún ASTA y su original. Pregúntale a tu vendedor.</div>
      </section>
    );
  }

  const c = calcularGanancia(pareja, margen, descuento);
  const porDefecto = Math.round(pareja.compraMensualOriginal + pareja.compraMensualAsta) || 10;
  const alMes = unidades ?? porDefecto;
  const elegir = (p: ParejaCalculadora) => {
    setElegida(clave(p));
    setUnidades(null);
  };

  return (
    <>
      <section className="panel calc">
        <div className="calc-controles">
          <label className="calc-campo">
            <span className="calc-etiqueta">Producto</span>
            <input className="input" value={filtro} placeholder="Busca por nombre, código o marca" onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar producto" />
            <select className="select" value={elegida} onChange={(e) => elegir(datos.parejas.find((p) => clave(p) === e.target.value)!)} aria-label="Producto" size={5}>
              {visibles.map((p) => (
                <option key={clave(p)} value={clave(p)}>
                  {p.compraMensualOriginal > 0 ? '★ ' : ''}
                  {sinMarca(p.asta.nombre)} ↔ {p.original.marca ?? ''} {p.original.sku}
                </option>
              ))}
            </select>
            <span className="stat-sub">★ el original que nos compras: donde más ganas cambiando</span>
          </label>
          <Porcentaje etiqueta="Lo que ganas en el original" valor={margen} max={100} alCambiar={setMargen} ayuda="Tu margen sobre lo que te cuesta el original." />
          <Porcentaje etiqueta="Descuento para tu cliente con ASTA" valor={descuento} max={60} alCambiar={setDescuento} ayuda="Cuánto más barato le vendes el ASTA que el original." />
          <label className="calc-campo">
            <span className="calc-etiqueta">Unidades al mes</span>
            <input className="input" type="number" min={0} max={100000} value={alMes} onChange={(e) => setUnidades(Math.max(0, Number(e.target.value) || 0))} aria-label="Unidades al mes" />
            <span className="stat-sub">{pareja.compraMensualOriginal + pareja.compraMensualAsta > 0 ? 'Lo que nos compras al mes de los dos.' : 'Pon las que vendes al mes.'}</span>
          </label>
        </div>

        <div className="calc-resultado">
          <div className="calc-comparacion">
            <div className="calc-columna">
              <span className="calc-marca">{pareja.original.marca ?? 'Original'}</span>
              <strong>{pareja.original.sku}</strong>
              <dl>
                <dt>Te cuesta</dt>
                <dd>{money(pareja.original.precio)}</dd>
                <dt>Lo vendes a</dt>
                <dd>{money(c.ventaOriginal)}</dd>
                <dt>Ganas</dt>
                <dd>{money(c.gananciaOriginal)}</dd>
              </dl>
            </div>
            <div className="calc-columna calc-asta">
              <span className="calc-marca">ASTA</span>
              <strong>{pareja.asta.sku}</strong>
              <dl>
                <dt>Te cuesta</dt>
                <dd>{money(pareja.asta.precio)}</dd>
                <dt>Lo vendes a</dt>
                <dd>{money(c.ventaAsta)}</dd>
                <dt>Ganas</dt>
                <dd>{money(c.gananciaAsta)}</dd>
              </dl>
            </div>
          </div>

          {c.gananciaExtra > 0 ? (
            <div className="calc-titulares">
              <p>
                <span>Tú ganas</span>
                <b>{money(c.gananciaExtra)} más</b>
                <span>por unidad</span>
              </p>
              <p>
                <span>Tu cliente ahorra</span>
                <b>{money(c.ahorroCliente)}</b>
                <span>{pct(descuento)} menos</span>
              </p>
              <p className="calc-mes">
                <span>Con {alMes.toLocaleString('es-VE')} al mes</span>
                <b>{money(c.gananciaExtra * alMes)} más</b>
                <span>al mes · {money(c.gananciaExtra * alMes * 12)} al año</span>
              </p>
            </div>
          ) : (
            <p className="notice aviso-sellout" style={{ margin: 0 }}>
              Con este descuento ganas {money(-c.gananciaExtra)} menos por unidad con ASTA. Baja el descuento para tu cliente.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Dónde más ganas cambiando a ASTA</h2>
        <p className="panel-nota">Con tu margen del {pct(margen)} y un descuento del {pct(descuento)} para tu cliente. Toca una fila para verla arriba.</p>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>ASTA</th>
                <th>En lugar de</th>
                <th className="num">Ganas de más</th>
                <th className="num">Tu cliente ahorra</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map(({ p, c: r }) => (
                <tr key={clave(p)} className={clave(p) === clave(pareja) ? 'calc-fila-activa' : undefined} onClick={() => elegir(p)} style={{ cursor: 'pointer' }}>
                  <td>
                    {sinMarca(p.asta.nombre)}
                    <div className="sku">{p.asta.sku}</div>
                  </td>
                  <td className="stat-sub">
                    {p.original.marca} {p.original.sku}
                    {p.compraMensualOriginal > 0 && ' ★'}
                  </td>
                  <td className="num">
                    <strong>{money(r.gananciaExtra)}</strong>
                  </td>
                  <td className="num">{money(r.ahorroCliente)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
