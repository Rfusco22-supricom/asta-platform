import Link from 'next/link';
import type { Gravedad, Revision } from '@asta/shared-types';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getCalidadDatos, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { money, moneyCompact, fechaHora } from '@/lib/formato';

/**
 * Calidad de datos: lo que está mal en Odoo y dónde se arregla.
 *
 * Una tarjeta por comprobación, de lo que mueve dinero a lo cosmético. Las
 * graves llegan abiertas; las que están a cero se quedan en una línea con un ✓,
 * porque saber que algo está bien también es información.
 *
 * El panel no corrige nada: cada fila lleva a su ficha en Odoo. La lista se lee
 * de Odoo (con diez minutos de cache), así que lo corregido sale solo.
 */

export const dynamic = 'force-dynamic';

const ODOO_URL = process.env.ODOO_URL ?? '';

const GRAVEDAD: Record<Gravedad, { etiqueta: string; resumen: string }> = {
  alta: { etiqueta: 'Mueve dinero', resumen: 'facturación que no ve nadie' },
  media: { etiqueta: 'Rompe algo', resumen: 'un cliente sin cuenta, un RIF que el SENIAT no reconoce' },
  baja: { etiqueta: 'Cosmético', resumen: 'se ve feo, no rompe nada' },
};

function modeloOdoo(r: Revision): string {
  if (r.clave === 'FACTURAS_SIN_VENDEDOR') return 'account.move';
  if (r.clave === 'NOMBRE_VENDEDOR') return 'res.users';
  return 'res.partner';
}

function columnaImporte(r: Revision): string {
  if (r.clave === 'FACTURAS_SIN_VENDEDOR') return 'Importe';
  if (r.clave === 'NOMBRE_VENDEDOR') return 'Su cartera, 12 m';
  return 'Facturado, 12 m';
}

const n = (x: number) => x.toLocaleString('es-VE');

export default async function CalidadPage({ searchParams }: { searchParams: Promise<{ fresco?: string }> }) {
  const sesion = await requireSession();
  const { fresco } = await searchParams;

  let datos;
  try {
    datos = await getCalidadDatos(sesion.accessToken, fresco === '1');
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Calidad de datos">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo leer Odoo'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const { revisiones, clientes, generadoEn } = datos;
  const porGravedad = (['alta', 'media', 'baja'] as const).map((g) => {
    const de = revisiones.filter((r) => r.gravedad === g);
    return { gravedad: g, total: de.reduce((s, r) => s + r.total, 0), pendientes: de.filter((r) => r.total > 0).length, de: de.length };
  });

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Calidad de datos"
      descripcion={`Lo que está mal en Odoo y dónde se arregla · ${n(clientes)} clientes con compras en los últimos 12 meses · leído el ${fechaHora(generadoEn)}`}
    >
      <section className="cd-resumen" aria-label="Resumen">
        {porGravedad.map((g) => (
          <div key={g.gravedad} className={`cd-resumen-item cd-${g.gravedad}`}>
            <span className="cd-punto" aria-hidden="true" />
            <div>
              <div className="cd-resumen-titulo">{GRAVEDAD[g.gravedad].etiqueta}</div>
              <div className="cd-resumen-cifra">
                {g.total === 0 ? 'Todo en orden' : `${n(g.total)} por corregir`}
              </div>
              <div className="stat-sub">
                {g.pendientes} de {g.de} comprobaciones con algo · {GRAVEDAD[g.gravedad].resumen}
              </div>
            </div>
          </div>
        ))}
        <Link className="btn btn-inline cd-releer" href="/admin/calidad?fresco=1" prefetch={false}>
          Volver a leer de Odoo
        </Link>
      </section>

      <div className="cd-lista">
        {revisiones.map((r) =>
          r.total === 0 ? (
            <div key={r.clave} className="cd-revision cd-ok">
              <span className="cd-check" aria-hidden="true">✓</span>
              <strong>{r.titulo}</strong>
              <span className="stat-sub">ninguno</span>
            </div>
          ) : (
            <details key={r.clave} className={`cd-revision cd-${r.gravedad}`} open={r.gravedad === 'alta'}>
              <summary>
                <span className="cd-gravedad">{GRAVEDAD[r.gravedad].etiqueta}</span>
                <span className="cd-titulo">{r.titulo}</span>
                <span className="cd-cuenta">
                  <strong>{n(r.total)}</strong> {r.unidad}
                </span>
                {r.facturado !== 0 && r.clave !== 'NOMBRE_VENDEDOR' && (
                  <span className="cd-monto" title={money(r.facturado)}>
                    {moneyCompact(r.facturado)}
                  </span>
                )}
                <span className="cd-chevron" aria-hidden="true" />
              </summary>

              <div className="cd-cuerpo">
                <div className="cd-explica">
                  <div>
                    <div className="cd-rotulo">Qué se rompe</div>
                    <p>{r.porQue}</p>
                  </div>
                  <div>
                    <div className="cd-rotulo">Cómo se arregla en Odoo</div>
                    <ol className="cd-ruta">
                      {r.comoArreglar.ruta.map((paso, i) => (
                        <li key={i}>{paso}</li>
                      ))}
                    </ol>
                    {r.comoArreglar.nota && <p className="stat-sub">{r.comoArreglar.nota}</p>}
                  </div>
                </div>

                <Tabla r={r} />

                {r.total > r.muestra.length && (
                  <p className="stat-sub cd-mas">
                    Se muestran los {n(r.muestra.length)} de más importe; quedan {n(r.total - r.muestra.length)}. Salen
                    aquí según se vayan corrigiendo los de arriba.
                  </p>
                )}
              </div>
            </details>
          ),
        )}
      </div>
    </Marco>
  );
}

function Tabla({ r }: { r: Revision }) {
  const conCompania = r.muestra.some((h) => h.compania);
  const conVendedor = r.muestra.some((h) => h.vendedor);
  // «Sin vendedor asignado» cien veces no dice nada que no diga el título.
  const conDetalle = new Set(r.muestra.map((h) => h.detalle)).size > 1;
  const modelo = modeloOdoo(r);

  return (
    <div className="table-wrap cd-tabla">
      <table>
        <thead>
          <tr>
            <th>{r.clave === 'NOMBRE_VENDEDOR' ? 'Vendedor' : 'Cliente'}</th>
            {conDetalle && <th>{r.clave === 'FACTURAS_SIN_VENDEDOR' ? 'Factura' : 'Qué tiene mal'}</th>}
            {conCompania && <th>Compañía</th>}
            {conVendedor && <th>Vendedor</th>}
            <th className="num">{columnaImporte(r)}</th>
            {ODOO_URL && <th aria-label="Abrir en Odoo" />}
          </tr>
        </thead>
        <tbody>
          {r.muestra.map((h) => (
            <tr key={h.id}>
              <td className="cd-nombre">{h.nombre}</td>
              {conDetalle && <td className="cd-detalle">{h.detalle}</td>}
              {conCompania && <td className="cd-compania">{h.compania ?? '—'}</td>}
              {conVendedor && <td>{h.vendedor ?? <span className="stat-sub">—</span>}</td>}
              <td className={`num${h.facturado === 0 ? ' zero' : ''}`}>{money(h.facturado)}</td>
              {ODOO_URL && (
                <td>
                  <a
                    className="enlace-accion"
                    href={`${ODOO_URL}/web#id=${h.id}&model=${modelo}&view_type=form`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Odoo ↗
                  </a>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
