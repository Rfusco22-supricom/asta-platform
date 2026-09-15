'use client';

import { useMemo, useState } from 'react';
import type { Agente } from '@asta/shared-types';
import { money, moneyCompact } from '@/lib/formato';

/**
 * Tabla de agentes con búsqueda y orden.
 *
 * ── Lo que NO hace, y es deliberado ──────────────────────────────────────────
 *
 * No pinta un ranking. Ordena por facturación porque hay que ordenar por algo,
 * pero no numera puestos ni colorea al último: una cartera heredada de 200
 * clientes y otra levantada desde cero no se comparan por el total, y no existe
 * el dato de objetivo en ninguna parte para comparar contra algo justo.
 *
 * Lo que sí señala en rojo es lo accionable: quién no puede entrar al panel y
 * qué proporción de lo facturado está sin cobrar.
 */

type Orden = 'facturado' | 'porCobrar' | 'clientes' | 'nombre';

function Etiqueta({
  children,
  tono,
}: {
  children: React.ReactNode;
  tono: 'bien' | 'aviso' | 'mal' | 'apagado';
}) {
  const colores = {
    bien: { c: 'var(--positive)', b: 'rgba(29,111,66,.10)' },
    aviso: { c: 'var(--warning)', b: 'var(--warning-soft)' },
    mal: { c: 'var(--danger)', b: 'var(--danger-soft)' },
    apagado: { c: 'var(--text-3)', b: 'var(--surface-2)' },
  }[tono];

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 550,
        padding: '2px 8px',
        borderRadius: 999,
        background: colores.b,
        color: colores.c,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** Estado de acceso al panel, que es la columna accionable de esta tabla. */
function Acceso({ agente }: { agente: Agente }) {
  if (!agente.activoEnOdoo) return <Etiqueta tono="apagado">de baja en Odoo</Etiqueta>;
  if (!agente.cuenta) return <Etiqueta tono="mal">sin cuenta</Etiqueta>;
  if (!agente.cuenta.activa) return <Etiqueta tono="mal">desactivada</Etiqueta>;
  if (!agente.cuenta.puedeEntrar) return <Etiqueta tono="aviso">sin contraseña</Etiqueta>;
  return <Etiqueta tono="bien">entra</Etiqueta>;
}

export function TablaAgentes({ filas }: { filas: Agente[] }) {
  const [busca, setBusca] = useState('');
  const [orden, setOrden] = useState<Orden>('facturado');
  const [soloProblemas, setSoloProblemas] = useState(false);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let r = filas;

    if (q) {
      r = r.filter((a) => a.nombre.toLowerCase().includes(q) || a.login.toLowerCase().includes(q));
    }

    // «Problemas» son los que trabajan hoy y no pueden ver su cartera. Un agente
    // de baja sin cuenta no es un problema: es lo correcto.
    if (soloProblemas) {
      r = r.filter((a) => a.activoEnOdoo && !a.cuenta?.puedeEntrar);
    }

    return [...r].sort((a, b) => {
      if (orden === 'nombre') return a.nombre.localeCompare(b.nombre, 'es');
      return b[orden] - a[orden];
    });
  }, [filas, busca, orden, soloProblemas]);

  const conProblema = filas.filter((a) => a.activoEnOdoo && !a.cuenta?.puedeEntrar).length;

  return (
    <>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Buscar por nombre o correo…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <div className="segmented">
          {(
            [
              ['facturado', 'Facturado'],
              ['porCobrar', 'Por cobrar'],
              ['clientes', 'Clientes'],
              ['nombre', 'Nombre'],
            ] as Array<[Orden, string]>
          ).map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              aria-pressed={orden === clave}
              onClick={() => setOrden(clave)}
            >
              {texto}
            </button>
          ))}
        </div>

        {conProblema > 0 && (
          <button
            type="button"
            className="segmented"
            style={{ padding: '7px 12px', fontSize: 12.5, cursor: 'pointer' }}
            aria-pressed={soloProblemas}
            onClick={() => setSoloProblemas((v) => !v)}
          >
            {soloProblemas ? '← Ver todos' : `Solo los ${conProblema} sin acceso`}
          </button>
        )}

        <span className="count">{visibles.length} de {filas.length}</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vendedor</th>
              <th className="num">Clientes</th>
              <th className="num">Facturado</th>
              <th className="num">Por cobrar</th>
              <th>Acceso al panel</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((a) => {
              // La proporción sin cobrar dice más que el importe: 6 M sobre 8 M
              // es otra conversación que 6 M sobre 60 M.
              const pct = a.facturado > 0 ? (a.porCobrar / a.facturado) * 100 : 0;

              return (
                <tr key={a.odooUserId}>
                  <td>
                    <div className="cliente-nombre">{a.nombre}</div>
                    <div className="cliente-contacto">{a.login || '—'}</div>
                  </td>

                  <td className="num">
                    {a.clientes.toLocaleString('es-VE')}
                    <div className="cliente-contacto">
                      {a.conCompra} con compra
                    </div>
                  </td>

                  <td className="num">
                    {moneyCompact(a.facturado)}
                    <div className="cliente-contacto" title={money(a.facturado)}>
                      {a.facturas.toLocaleString('es-VE')} facturas
                    </div>
                  </td>

                  <td className={pct >= 50 ? 'num debt' : 'num'}>
                    {moneyCompact(a.porCobrar)}
                    {a.facturado > 0 && (
                      <div className="cliente-contacto">{pct.toFixed(0)} % del total</div>
                    )}
                  </td>

                  <td>
                    <Acceso agente={a} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibles.length === 0 && <div className="empty">Ningún vendedor coincide.</div>}
      </div>
    </>
  );
}
