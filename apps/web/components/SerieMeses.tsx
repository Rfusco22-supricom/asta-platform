'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { money, moneyCompact } from '@/lib/formato';
import { etiquetaMes, nombreMes } from '@/lib/meses';

/**
 * El gráfico «mes a mes», y el detalle de cada mes al pulsar su barra.
 *
 * Las barras ya decían cuánto; el detalle dice de quién: los clientes que más
 * compraron ese mes, los vendedores (en la vista de la empresa) y los productos
 * ASTA. Se pide al puente `/api/reportes/mes`, que pregunta al middleware por la
 * ruta de cada rol: el gráfico no sabe ni decide qué puede ver nadie.
 *
 * Un mes ya abierto no se vuelve a pedir mientras la página siga abierta.
 */

interface Punto {
  periodo: string;
  monto: number;
  facturas: number;
}

interface DetalleMes {
  periodo: string;
  vista: 'empresa' | 'cartera';
  ambito: string;
  fuente: 'Smartbit' | 'Odoo';
  totales: { facturado: number; porCobrar: number; facturas: number; ticketPromedio: number; clientes: number };
  topClientes: { partnerId: number | null; nombre: string; facturado: number; facturas: number }[];
  porVendedor: { odooUserId: number | null; nombre: string; facturado: number; facturas: number }[] | null;
  productos: { productId: number; sku: string | null; nombre: string; cantidad: number; monto: number }[] | null;
  enlace: string;
}

type Estado = { tipo: 'cargando' } | { tipo: 'listo'; datos: DetalleMes } | { tipo: 'error'; mensaje: string };

const n = (x: number) => x.toLocaleString('es-VE');

export function Serie({ puntos, sede = null }: { puntos: Punto[]; sede?: number | null }) {
  const maximo = Math.max(...puntos.map((p) => p.monto), 1);
  const [abierto, setAbierto] = useState<string | null>(null);
  const cache = useRef(new Map<string, DetalleMes>());

  return (
    <>
      <div className="serie">
        {puntos.map((p) => {
          const alto = Math.max((p.monto / maximo) * 100, p.monto > 0 ? 2 : 0);
          return (
            <button
              type="button"
              className="serie-col"
              key={p.periodo}
              onClick={() => setAbierto(p.periodo)}
              aria-label={`Ver el detalle de ${nombreMes(p.periodo)}: ${money(p.monto)}`}
              aria-haspopup="dialog"
            >
              <span className="serie-monto">{p.monto > 0 ? moneyCompact(p.monto) : '—'}</span>
              <span className="serie-pista">
                <span
                  className={p.monto > 0 ? 'serie-barra' : 'serie-barra vacia'}
                  style={{ height: `${alto}%` }}
                  title={`${money(p.monto)} · ${p.facturas} facturas`}
                />
              </span>
              <span className="serie-mes">{etiquetaMes(p.periodo)}</span>
            </button>
          );
        })}
      </div>
      {abierto && (
        <DetalleDelMes
          periodo={abierto}
          puntos={puntos}
          sede={sede}
          cache={cache.current}
          onCambiar={setAbierto}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </>
  );
}

function DetalleDelMes({
  periodo,
  puntos,
  sede,
  cache,
  onCambiar,
  onCerrar,
}: {
  periodo: string;
  puntos: Punto[];
  sede: number | null;
  cache: Map<string, DetalleMes>;
  onCambiar: (periodo: string) => void;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [estado, setEstado] = useState<Estado>(() => {
    const guardado = cache.get(periodo);
    return guardado ? { tipo: 'listo', datos: guardado } : { tipo: 'cargando' };
  });

  // Abrir como modal (con fondo y foco atrapado) al montar. Sin cerrar al
  // desmontar: en desarrollo React monta dos veces, y ese `close()` dispararía
  // `onClose` y cerraría el detalle nada más abrirlo. Al quitarse del DOM, el
  // diálogo deja de estar abierto solo.
  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const guardado = cache.get(periodo);
    if (guardado) {
      setEstado({ tipo: 'listo', datos: guardado });
      return;
    }
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    const qs = new URLSearchParams({ periodo });
    if (sede !== null) qs.set('sede', String(sede));
    fetch(`/api/reportes/mes?${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!vigente) return;
        if (!res.ok || !body?.data) {
          setEstado({ tipo: 'error', mensaje: body?.error?.message ?? 'No se pudo leer el mes.' });
          return;
        }
        cache.set(periodo, body.data as DetalleMes);
        setEstado({ tipo: 'listo', datos: body.data as DetalleMes });
      })
      .catch(() => vigente && setEstado({ tipo: 'error', mensaje: 'No se pudo contactar con el servidor.' }));
    return () => {
      vigente = false;
    };
  }, [periodo, sede, cache]);

  const i = puntos.findIndex((p) => p.periodo === periodo);
  const punto = puntos[i];
  const anterior = i > 0 ? puntos[i - 1] : null;
  const siguiente = i >= 0 && i < puntos.length - 1 ? puntos[i + 1] : null;
  const variacion = punto && anterior && anterior.monto > 0 ? ((punto.monto - anterior.monto) / anterior.monto) * 100 : null;

  return (
    <dialog
      ref={dialogo}
      className="mes-detalle"
      aria-labelledby="mes-detalle-titulo"
      onClose={onCerrar}
      // Un clic en el fondo (fuera de la caja) cierra.
      onClick={(e) => e.target === e.currentTarget && dialogo.current?.close()}
    >
      <div className="mes-detalle-caja">
        <header className="mes-detalle-cabecera">
          <div>
            <p className="mes-detalle-ambito">
              {estado.tipo === 'listo' ? `${estado.datos.ambito} · ASTA sin IVA · datos de ${estado.datos.fuente}` : 'ASTA sin IVA'}
            </p>
            <h2 id="mes-detalle-titulo">{nombreMes(periodo)}</h2>
          </div>
          <button type="button" className="mes-detalle-cerrar" onClick={() => dialogo.current?.close()} aria-label="Cerrar">
            ×
          </button>
        </header>

        <nav className="mes-detalle-nav" aria-label="Cambiar de mes">
          <button type="button" className="btn-link" disabled={!anterior} onClick={() => anterior && onCambiar(anterior.periodo)}>
            ← {anterior ? etiquetaMes(anterior.periodo) : ''}
          </button>
          <button type="button" className="btn-link" disabled={!siguiente} onClick={() => siguiente && onCambiar(siguiente.periodo)}>
            {siguiente ? etiquetaMes(siguiente.periodo) : ''} →
          </button>
        </nav>

        {estado.tipo === 'cargando' && <p className="mes-detalle-nota">Leyendo el mes…</p>}
        {estado.tipo === 'error' && <p className="mes-detalle-nota error">{estado.mensaje}</p>}
        {estado.tipo === 'listo' && <Contenido datos={estado.datos} variacion={variacion} anterior={anterior} />}
      </div>
    </dialog>
  );
}

function Contenido({ datos, variacion, anterior }: { datos: DetalleMes; variacion: number | null; anterior: Punto | null }) {
  const { totales } = datos;
  const smartbit = datos.fuente === 'Smartbit';
  if (totales.facturas === 0) {
    return <p className="mes-detalle-nota">No hubo ventas de ASTA este mes.</p>;
  }
  return (
    <>
      <div className="mes-detalle-cifras">
        <div>
          <span className="mes-detalle-etiqueta">Vendido en ASTA</span>
          <strong title={money(totales.facturado)}>{moneyCompact(totales.facturado)}</strong>
          {variacion !== null && anterior && (
            <span className={variacion >= 0 ? 'mes-detalle-var sube' : 'mes-detalle-var baja'}>
              {variacion >= 0 ? '▲' : '▼'} {Math.abs(variacion).toLocaleString('es-VE', { maximumFractionDigits: 1 })} % frente a {etiquetaMes(anterior.periodo)}
            </span>
          )}
        </div>
        <div>
          {/* Smartbit no tiene número de factura: una compra es un cliente en un día con un vendedor. */}
          <span className="mes-detalle-etiqueta">{smartbit ? 'Compras' : 'Facturas'}</span>
          <strong>{n(totales.facturas)}</strong>
        </div>
        <div>
          <span className="mes-detalle-etiqueta">Ticket promedio</span>
          <strong>{money(totales.ticketPromedio)}</strong>
        </div>
        <div>
          <span className="mes-detalle-etiqueta">Clientes</span>
          <strong>{n(totales.clientes)}</strong>
        </div>
      </div>

      <Lista
        titulo="Los clientes que más compraron"
        filas={datos.topClientes.map((c) => ({
          clave: `${c.partnerId ?? c.nombre}`,
          nombre: c.nombre,
          monto: c.facturado,
          detalle: `${n(c.facturas)} ${smartbit ? (c.facturas === 1 ? 'compra' : 'compras') : c.facturas === 1 ? 'factura' : 'facturas'}`,
          href: c.partnerId ? `/cartera/${c.partnerId}` : undefined,
        }))}
      />

      {datos.porVendedor && datos.porVendedor.length > 0 && (
        <Lista
          titulo="Por vendedor"
          filas={datos.porVendedor.map((v) => ({
            clave: `${v.odooUserId ?? v.nombre}`,
            nombre: v.nombre,
            monto: v.facturado,
            detalle: `${n(v.facturas)} ${v.facturas === 1 ? 'factura' : 'facturas'}`,
          }))}
        />
      )}

      {datos.productos && datos.productos.length > 0 && (
        <Lista
          titulo="Los productos ASTA más vendidos"
          filas={datos.productos.map((p) => ({
            clave: String(p.productId),
            nombre: p.nombre,
            monto: p.monto,
            detalle: `${p.sku ? `${p.sku} · ` : ''}${n(p.cantidad)} ${p.cantidad === 1 ? 'unidad' : 'unidades'}`,
          }))}
        />
      )}

      <p className="mes-detalle-pie">
        <Link href={datos.enlace}>Ver el reporte completo de este mes →</Link>
      </p>
    </>
  );
}

function Lista({
  titulo,
  filas,
}: {
  titulo: string;
  filas: { clave: string; nombre: string; monto: number; detalle: string; href?: string }[];
}) {
  if (filas.length === 0) return null;
  const maximo = Math.max(...filas.map((f) => f.monto), 1);
  return (
    <section className="mes-detalle-lista">
      <h3>{titulo}</h3>
      <ol>
        {filas.map((f) => (
          <li key={f.clave}>
            <span className="mes-detalle-nombre">
              {f.href ? <Link href={f.href}>{f.nombre}</Link> : f.nombre}
              <small>{f.detalle}</small>
            </span>
            <span className="mes-detalle-monto" title={money(f.monto)}>
              {moneyCompact(f.monto)}
            </span>
            <span className="mes-detalle-barra" aria-hidden="true">
              <span style={{ width: `${(f.monto / maximo) * 100}%` }} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
