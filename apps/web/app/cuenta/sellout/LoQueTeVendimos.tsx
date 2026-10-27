'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PorMarcar, ProductoPorMarcar } from '@asta/shared-types';
import { nombreMes } from '@/lib/meses';

/**
 * «Lo que te vendimos»: los productos ASTA que el cliente nos compró, y en cada
 * uno cuántas vendió en el mes. Lo que marca es su reporte de ventas del mes,
 * el mismo que si subiera el Excel; se guarda solo, un momento después de
 * dejar de tocar.
 *
 * Lo que se manda es el TOTAL del mes de ese producto, no lo que suma: si un
 * envío se repite, no cuenta dos veces.
 */

const ESPERA_MS = 700;
const n = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 2 });

function mesAnterior(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
}

/** Lo que le queda si lo vendido del mes fuera `delMes` en vez de lo guardado. */
function quedanCon(p: ProductoPorMarcar, delMes: number): number {
  return Math.max(0, p.base + p.compradas - (p.vendidas - p.vendidasMes + delMes));
}

export function LoQueTeVendimos({ inicial }: { inicial: PorMarcar }) {
  const router = useRouter();
  const actual = inicial.mes;
  const [datos, setDatos] = useState(inicial);
  const [borradores, setBorradores] = useState<Map<number, number>>(new Map());
  const [guardando, setGuardando] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const relojes = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => () => relojes.current.forEach(clearTimeout), []);

  async function guardar(mes: string, productId: number, cantidad: number) {
    setGuardando((g) => g + 1);
    try {
      const res = await fetch('/api/sellout/marcar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes, productId, cantidad }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? 'No se pudo guardar.');
      setDatos(body.data as PorMarcar);
      // Si entretanto lo cambió otra vez, ese borrador sigue pendiente.
      setBorradores((b) => {
        if (b.get(productId) !== cantidad) return b;
        const sin = new Map(b);
        sin.delete(productId);
        return sin;
      });
      setMensaje(null);
      router.refresh();
    } catch (error) {
      setBorradores((b) => {
        const sin = new Map(b);
        sin.delete(productId);
        return sin;
      });
      setMensaje(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      setGuardando((g) => g - 1);
    }
  }

  function cambiar(p: ProductoPorMarcar, valor: number) {
    const cantidad = Math.max(0, Math.round(valor));
    setBorradores((b) => new Map(b).set(p.productId, cantidad));
    clearTimeout(relojes.current.get(p.productId));
    const mes = datos.mes;
    relojes.current.set(
      p.productId,
      setTimeout(() => {
        relojes.current.delete(p.productId);
        void guardar(mes, p.productId, cantidad);
      }, ESPERA_MS),
    );
  }

  async function verMes(mes: string) {
    if (mes === datos.mes || guardando > 0 || borradores.size > 0) return;
    setCargando(true);
    setMensaje(null);
    try {
      const res = await fetch(`/api/sellout/marcar?mes=${mes}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? 'No se pudo cargar ese mes.');
      setDatos(body.data as PorMarcar);
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : 'No se pudo cargar ese mes.');
    } finally {
      setCargando(false);
    }
  }

  const pendiente = guardando > 0 || borradores.size > 0;
  const mesLargo = nombreMes(datos.mes).toLowerCase();

  return (
    <section className="panel so-marcar" aria-labelledby="so-marcar-titulo" aria-busy={cargando}>
      <div className="so-subir-cabeza">
        <h2 id="so-marcar-titulo">Lo que te vendimos</h2>
        <div className="segmented" role="group" aria-label="Mes que marcas">
          {[actual, mesAnterior(actual)].map((m) => (
            <button key={m} type="button" aria-pressed={datos.mes === m} disabled={cargando || pendiente} onClick={() => void verMes(m)}>
              {m === actual ? 'Este mes' : nombreMes(m)}
            </button>
          ))}
        </div>
      </div>
      <p className="stat-sub so-marcar-intro">
        Marca cuántas vendiste de cada producto en {mesLargo}: se guarda solo.{' '}
        {datos.inventario
          ? `Lo que te queda cuenta desde tu conteo de inventario de ${nombreMes(datos.inventario).toLowerCase()}.`
          : `Lo que te queda cuenta lo que nos compraste desde ${nombreMes(datos.desde).toLowerCase()}.`}
      </p>
      {mensaje && (
        <p className="so-error" role="alert">
          {mensaje}
        </p>
      )}

      {datos.productos.length === 0 ? (
        <div className="empty">No hay compras de ASTA en estos meses.</div>
      ) : (
        <ul className="so-marcar-lista">
          {datos.productos.map((p) => {
            const delMes = borradores.get(p.productId) ?? p.vendidasMes;
            const quedan = quedanCon(p, delMes);
            return (
              <li key={p.productId} className="so-marcar-fila">
                <div className="so-marcar-producto">
                  <strong>{p.nombre.replace(/^ASTA\s+/i, '')}</strong>
                  <span className="stat-sub">
                    {p.sku && <span className="sku">{p.sku}</span>}
                    {p.base > 0 && ` Tenías ${n(p.base)} ·`} Compraste {n(p.compradas)} · Vendiste {n(p.vendidas - p.vendidasMes + delMes)}
                  </span>
                </div>
                <div className="so-marcar-quedan">
                  {quedan > 0 ? (
                    <>
                      <b>{n(quedan)}</b>
                      <span>te {quedan === 1 ? 'queda' : 'quedan'}</span>
                    </>
                  ) : (
                    <span className="tag so-reponer">Agotado · para reponer</span>
                  )}
                </div>
                <div className="so-marcar-contador">
                  <button type="button" aria-label={`Una menos de ${p.nombre}`} disabled={delMes <= 0 || cargando} onClick={() => cambiar(p, delMes - 1)}>
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={delMes}
                    disabled={cargando}
                    aria-label={`Vendidas de ${p.nombre} en ${mesLargo}`}
                    onChange={(e) => cambiar(p, Number(e.target.value) || 0)}
                  />
                  <button type="button" aria-label={`Una más de ${p.nombre}`} disabled={cargando} onClick={() => cambiar(p, delMes + 1)}>
                    +
                  </button>
                  <span className="stat-sub">vendidas</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="stat-sub so-marcar-estado" aria-live="polite">
        {pendiente ? 'Guardando…' : ' '}
      </p>
    </section>
  );
}
