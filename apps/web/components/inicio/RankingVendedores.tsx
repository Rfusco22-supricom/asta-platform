'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { FacturaDelVendedor, FacturasDelVendedor } from '@asta/shared-types';
import { fecha, money, moneyCompact } from '@/lib/formato';

/**
 * El ranking de vendedores del Inicio del administrador, y al pulsar uno, sus
 * facturas del periodo en una ventana: qué hay detrás de su cifra sin salir del
 * Inicio. Cifras arriba, un buscador (cliente o número), filtros por estado y la
 * lista, de la más reciente a la más antigua o de mayor a menor importe.
 *
 * Se piden al puente `/api/reportes/vendedor` (solo el administrador). Un
 * vendedor ya abierto no se vuelve a pedir mientras la página siga abierta.
 * Solo montos de ASTA: de una factura con otras marcas sale su parte ASTA.
 */

export interface FilaVendedor {
  odooUserId: number | null;
  nombre: string;
  facturado: number;
  facturas: number;
}

type Estado = { tipo: 'cargando' } | { tipo: 'listo'; datos: FacturasDelVendedor } | { tipo: 'error'; mensaje: string };
type Filtro = 'todas' | 'cobrar' | 'notas';
type Orden = 'fecha' | 'monto';

const n = (x: number) => x.toLocaleString('es-VE');
const plural = (x: number, uno: string, varios: string) => `${n(x)} ${x === 1 ? uno : varios}`;

export function RankingVendedores({
  filas,
  rango,
  sede,
  periodo,
  enlace,
}: {
  filas: FilaVendedor[];
  rango: { desde: string; hasta: string };
  sede: number | null;
  /** «noviembre 2026», «2026»…: para la cabecera de la ventana. */
  periodo: string;
  enlace: { href: string; texto: string };
}) {
  const [abierto, setAbierto] = useState<FilaVendedor | null>(null);
  const cache = useRef(new Map<string, FacturasDelVendedor>());
  const maximo = Math.max(0, ...filas.map((f) => f.facturado));

  // La ventana va FUERA de la tarjeta: dentro heredaría los estilos del ranking (`.dash-ranking li`, `h2`).
  return (
    <>
      <section className="panel dash-vendedores dash-ranking">
        <h2>Vendedores</h2>
        {filas.length === 0 ? (
          <div className="empty">Sin ventas de ASTA en el periodo.</div>
        ) : (
          <ol>
            {filas.map((f, i) => {
              const contenido = (
                <>
                  <span className="dash-pos">{i + 1}</span>
                  <span className="dash-nombre">
                    <span data-privado>{f.nombre}</span>
                    <small>{plural(f.facturas, 'factura', 'facturas')}</small>
                  </span>
                  <Proporcion valor={f.facturado} maximo={maximo} />
                </>
              );
              return (
                <li key={f.odooUserId ?? f.nombre}>
                  {f.odooUserId ? (
                    <button
                      type="button"
                      className="dash-fila"
                      onClick={() => setAbierto(f)}
                      aria-haspopup="dialog"
                      aria-label={`${f.nombre}: ver sus facturas`}
                      title="Ver sus facturas"
                    >
                      {contenido}
                      <span className="dash-fila-ir" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ) : (
                    <div className="dash-fila">{contenido}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <Link className="dash-mas" href={enlace.href}>
          {enlace.texto} →
        </Link>
      </section>

      {abierto?.odooUserId && (
        <FacturasVendedor
          key={abierto.odooUserId}
          fila={abierto}
          odooUserId={abierto.odooUserId}
          rango={rango}
          sede={sede}
          periodo={periodo}
          cache={cache.current}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </>
  );
}

function FacturasVendedor({
  fila,
  odooUserId,
  rango,
  sede,
  periodo,
  cache,
  onCerrar,
}: {
  fila: FilaVendedor;
  odooUserId: number;
  rango: { desde: string; hasta: string };
  sede: number | null;
  periodo: string;
  cache: Map<string, FacturasDelVendedor>;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const clave = `${odooUserId}:${sede ?? 'todas'}:${rango.desde}:${rango.hasta}`;
  const [estado, setEstado] = useState<Estado>(() => {
    const guardado = cache.get(clave);
    return guardado ? { tipo: 'listo', datos: guardado } : { tipo: 'cargando' };
  });

  // Como el detalle del mes: abrir como modal al montar, sin cerrarlo al desmontar.
  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (cache.has(clave)) return;
    let vigente = true;
    const qs = new URLSearchParams({ odooUserId: String(odooUserId), desde: rango.desde, hasta: rango.hasta });
    if (sede !== null) qs.set('sede', String(sede));
    fetch(`/api/reportes/vendedor?${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!vigente) return;
        if (!res.ok || !body?.data) {
          setEstado({ tipo: 'error', mensaje: body?.error?.message ?? 'No se pudieron leer las facturas.' });
          return;
        }
        cache.set(clave, body.data as FacturasDelVendedor);
        setEstado({ tipo: 'listo', datos: body.data as FacturasDelVendedor });
      })
      .catch(() => vigente && setEstado({ tipo: 'error', mensaje: 'No se pudo contactar con el servidor.' }));
    return () => {
      vigente = false;
    };
  }, [clave, odooUserId, rango.desde, rango.hasta, sede, cache]);

  const pagina = `/admin/agentes/${odooUserId}?${new URLSearchParams({ desde: rango.desde, hasta: rango.hasta })}`;

  return (
    <dialog
      ref={dialogo}
      className="mes-detalle vendedor-modal"
      aria-labelledby="vendedor-modal-titulo"
      onClose={onCerrar}
      // Un clic en el fondo (fuera de la caja) cierra.
      onClick={(e) => e.target === e.currentTarget && dialogo.current?.close()}
    >
      <div className="mes-detalle-caja">
        <header className="mes-detalle-cabecera">
          <div>
            <p className="mes-detalle-ambito">Facturas con ASTA · {periodo} · sin IVA</p>
            <h2 id="vendedor-modal-titulo" data-privado>
              {fila.nombre}
            </h2>
          </div>
          <button type="button" className="mes-detalle-cerrar" onClick={() => dialogo.current?.close()} aria-label="Cerrar">
            ×
          </button>
        </header>

        {estado.tipo === 'cargando' && <p className="mes-detalle-nota">Leyendo sus facturas…</p>}
        {estado.tipo === 'error' && <p className="mes-detalle-nota error">{estado.mensaje}</p>}
        {estado.tipo === 'listo' && <Contenido datos={estado.datos} />}

        <p className="mes-detalle-pie">
          <Link href={pagina}>Ver todo lo de este vendedor →</Link>
        </p>
      </div>
    </dialog>
  );
}

function Contenido({ datos }: { datos: FacturasDelVendedor }) {
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [orden, setOrden] = useState<Orden>('fecha');
  const { totales } = datos;

  const vencido = datos.facturas.reduce((s, f) => s + (f.vencida ? f.porCobrar : 0), 0);
  const cuenta: Record<Filtro, number> = {
    todas: datos.facturas.length,
    cobrar: datos.facturas.filter((f) => f.porCobrar > 0).length,
    notas: totales.notas,
  };

  const filas = useMemo(() => {
    const texto = normalizar(buscar);
    const lista = datos.facturas.filter(
      (f) =>
        (filtro === 'todas' || (filtro === 'cobrar' ? f.porCobrar > 0 : f.tipo === 'nota')) &&
        (!texto || normalizar(`${f.cliente} ${f.numero ?? ''}`).includes(texto)),
    );
    return orden === 'monto' ? [...lista].sort((a, b) => b.monto - a.monto) : lista;
  }, [datos.facturas, buscar, filtro, orden]);

  if (datos.facturas.length === 0) return <p className="mes-detalle-nota">No tiene facturas con ASTA en este periodo.</p>;

  const filtros: Array<{ valor: Filtro; titulo: string }> = [
    { valor: 'todas', titulo: 'Todas' },
    { valor: 'cobrar', titulo: 'Por cobrar' },
    ...(totales.notas > 0 ? [{ valor: 'notas' as const, titulo: 'Notas de crédito' }] : []),
  ];

  return (
    <>
      <div className="mes-detalle-cifras vendedor-cifras">
        <div>
          <span className="mes-detalle-etiqueta">Vendido en ASTA</span>
          <strong title={money(totales.facturado)}>{moneyCompact(totales.facturado)}</strong>
        </div>
        <div>
          <span className="mes-detalle-etiqueta">Facturas</span>
          <strong>{n(totales.facturas)}</strong>
          {totales.notas > 0 && <span className="stat-sub">y {plural(totales.notas, 'nota de crédito', 'notas de crédito')}</span>}
        </div>
        <div>
          <span className="mes-detalle-etiqueta">Clientes</span>
          <strong>{n(totales.clientes)}</strong>
        </div>
        <div>
          <span className="mes-detalle-etiqueta">Por cobrar</span>
          <strong title={money(totales.porCobrar)}>{moneyCompact(totales.porCobrar)}</strong>
          {/* El saldo de una factura lleva IVA; lo vendido, no. */}
          <span className="stat-sub">
            con IVA{vencido > 0 && <span className="vendedor-vencido"> · {moneyCompact(vencido)} vencido</span>}
          </span>
        </div>
      </div>

      <div className="vendedor-controles">
        <label className="pi-buscar">
          <span className="pi-lupa" aria-hidden="true">
            ⌕
          </span>
          <input
            className="input"
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar cliente o número de factura"
            aria-label="Buscar cliente o número de factura"
          />
        </label>
        <div className="pi-vistas" role="group" aria-label="Qué facturas ver">
          {filtros.map((f) => (
            <button key={f.valor} type="button" aria-pressed={filtro === f.valor} onClick={() => setFiltro(f.valor)}>
              {f.titulo}
              <span className="pi-cuenta">{n(cuenta[f.valor])}</span>
            </button>
          ))}
        </div>
        <select className="select" value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar">
          <option value="fecha">Más recientes</option>
          <option value="monto">Mayor importe</option>
        </select>
      </div>

      {filas.length === 0 ? (
        <p className="mes-detalle-nota">Ninguna factura coincide con la búsqueda.</p>
      ) : (
        <ol className="vendedor-facturas">
          {filas.map((f) => (
            <Factura key={f.id ?? `${f.fecha}:${f.cliente}`} f={f} />
          ))}
        </ol>
      )}
      {filas.length > 0 && filas.length < datos.facturas.length && (
        <p className="vendedor-cuantas">
          {n(filas.length)} de {n(datos.facturas.length)}
        </p>
      )}
    </>
  );
}

function Factura({ f }: { f: FacturaDelVendedor }) {
  const documento = f.tipo === 'smartbit' ? 'Compra en Smartbit' : f.tipo === 'nota' ? `Nota de crédito ${f.numero}` : `Factura ${f.numero}`;
  const estado =
    f.tipo === 'nota' ? 'resta' : f.tipo === 'smartbit' ? '—' : f.porCobrar > 0 ? `debe ${money(f.porCobrar)} con IVA${f.vencida ? ' · vencida' : ''}` : 'cobrada';
  return (
    <li className={`vendedor-factura${f.tipo === 'nota' ? ' es-nota' : ''}`}>
      <span className="vendedor-factura-cliente">
        <span data-privado>{f.partnerId ? <Link href={`/cartera/${f.partnerId}`}>{f.cliente}</Link> : f.cliente}</span>
        <small>
          {documento} · {fecha(f.fecha)}
        </small>
      </span>
      <span className="vendedor-factura-monto">
        <strong title={money(f.monto)}>{money(f.monto)}</strong>
        <small className={f.vencida ? 'vencida' : f.porCobrar > 0 ? 'pendiente' : ''}>{estado}</small>
      </span>
    </li>
  );
}

/** La barra y el importe, como `Proporcion` de Reporte (que es de servidor y aquí no se importa). */
function Proporcion({ valor, maximo }: { valor: number; maximo: number }) {
  const ancho = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return (
    <span className="proporcion">
      <span className="proporcion-barra" aria-hidden="true">
        <span style={{ width: `${ancho}%` }} />
      </span>
      {money(valor)}
    </span>
  );
}

/** Sin acentos ni mayúsculas, para que «briceno» encuentre «BRICEÑO». */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}
