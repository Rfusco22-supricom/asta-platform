'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ClienteImpulsa, EstadoImpulsa, SugerenciaPasale } from '@asta/shared-types';
import { fecha, money } from '@/lib/formato';

/**
 * Las sugerencias de «Pásale a ASTA», cliente por cliente, con sus botones.
 *
 * Marcar va por `/api/impulsa` (el navegador no tiene el token) y después se
 * vuelve a pedir la página: las sugerencias salen de la caché del middleware y
 * las marcas de MySQL, así que la vuelta es rápida y lo que se ve es lo que hay
 * guardado, no una suposición del navegador.
 */

type Vista = 'pendientes' | 'atendidas';

export function ListaImpulsa({ clientes }: { clientes: ClienteImpulsa[] }) {
  const [vista, setVista] = useState<Vista>('pendientes');
  const visibles = clientes
    .map((c) => ({ ...c, sugerencias: c.sugerencias.filter((s) => (vista === 'pendientes' ? s.visible : !s.visible)) }))
    .filter((c) => c.sugerencias.length > 0);

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Qué sugerencias ver">
          <button type="button" aria-pressed={vista === 'pendientes'} onClick={() => setVista('pendientes')}>
            Pendientes
          </button>
          <button type="button" aria-pressed={vista === 'atendidas'} onClick={() => setVista('atendidas')}>
            Hechas y pospuestas
          </button>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="empty imp-vacio">
          {vista === 'pendientes'
            ? clientes.length === 0
              ? 'Hoy no hay ningún cliente al que pasarle a ASTA: o ya compran ASTA, o no hay existencias del equivalente.'
              : 'Has atendido todas las sugerencias. Las hechas vuelven si el cliente compra otra vez el original.'
            : 'Todavía no has marcado ninguna.'}
        </div>
      ) : (
        <div className="imp-lista">
          {visibles.map((c) => (
            <section key={c.partnerId} className="panel imp-cliente">
              <header className="imp-cabecera">
                <Link href={`/cartera/${c.partnerId}`} className="imp-nombre">
                  {c.nombre}
                </Link>
                {vista === 'pendientes' && c.enJuego > 0 && <span className="imp-enjuego">{money(c.enJuego)} en otras marcas</span>}
              </header>
              <ul className="imp-sugerencias">
                {c.sugerencias.map((s) => (
                  <Sugerencia key={s.clave} partnerId={c.partnerId} s={s} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Sugerencia({ partnerId, s }: { partnerId: number; s: SugerenciaPasale }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [posponiendo, setPosponiendo] = useState(false);

  const marcar = (estado: EstadoImpulsa, dias?: 7 | 30) => {
    setError(null);
    empezar(async () => {
      const res = await fetch('/api/impulsa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, tipo: 'pasale_a_asta', clave: s.clave, estado, dias }),
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(cuerpo?.error?.message ?? 'No se pudo guardar. Inténtalo otra vez.');
        return;
      }
      setPosponiendo(false);
      router.refresh();
    });
  };

  const o = s.original;
  // Unidades por pedido: si el ASTA tiene menos, que el vendedor lo sepa antes de llamar.
  const porPedido = o.facturas > 0 ? Math.round(o.cantidad / o.facturas) : o.cantidad;

  return (
    <li className={pendiente ? 'imp-sugerencia guardando' : 'imp-sugerencia'}>
      <div className="imp-compra">
        <span className="imp-rotulo">Compra</span>
        <span className="imp-producto">
          {o.sku && <span className="rp-sku">{o.sku}</span>}
          {o.nombre}
        </span>
        <small>
          {money(o.monto)} · {o.cantidad.toLocaleString('es')} u. en {o.facturas} {o.facturas === 1 ? 'factura' : 'facturas'} · última el {fecha(o.ultimaCompra)}
        </small>
      </div>

      <span className="imp-flecha" aria-hidden="true">
        →
      </span>

      <div className="imp-asta">
        <span className="imp-rotulo">Ofrécele ASTA</span>
        {s.asta.map((a) => (
          <span key={a.productId} className="imp-alternativa">
            <span className="imp-producto">
              {a.sku && <span className="rp-sku">{a.sku}</span>}
              {a.nombre}
            </span>
            <small className={a.disponible < porPedido ? 'imp-corto' : undefined}>
              hay {a.disponible.toLocaleString('es')}
              {a.disponible < porPedido && ` · pocas para lo que compra (~${porPedido} por pedido)`}
            </small>
          </span>
        ))}
      </div>

      <div className="imp-acciones">
        {s.visible ? (
          <>
            <button type="button" className="btn btn-inline" disabled={pendiente} onClick={() => marcar('HECHA')}>
              ✓ Hecho
            </button>
            {posponiendo ? (
              <span className="imp-posponer">
                <button type="button" className="btn-link" disabled={pendiente} onClick={() => marcar('POSPUESTA', 7)}>
                  7 días
                </button>
                <button type="button" className="btn-link" disabled={pendiente} onClick={() => marcar('POSPUESTA', 30)}>
                  30 días
                </button>
                <button type="button" className="btn-link" disabled={pendiente} onClick={() => setPosponiendo(false)}>
                  ✕
                </button>
              </span>
            ) : (
              <button type="button" className="btn-link" disabled={pendiente} onClick={() => setPosponiendo(true)}>
                Posponer
              </button>
            )}
          </>
        ) : (
          <>
            <span className="imp-marca">
              {s.marca?.estado === 'POSPUESTA' && s.marca.hasta ? `Pospuesta hasta el ${fecha(s.marca.hasta)}` : 'Hecha'}
            </span>
            <button type="button" className="btn-link" disabled={pendiente} onClick={() => marcar('ACTIVA')}>
              Deshacer
            </button>
          </>
        )}
        {error && (
          <span className="imp-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </li>
  );
}
