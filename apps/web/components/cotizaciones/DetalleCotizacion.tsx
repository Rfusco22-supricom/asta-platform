import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DIAS_SIN_RESPUESTA } from '@asta/shared-types';
import type { Session } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Cifra } from '@/components/Cifras';
import { ApiError, esRedireccion, getCotizacion } from '@/lib/api';
import { fecha, money } from '@/lib/formato';

/**
 * La página de una cotización: a quién, de quién, cuánto espera y sus
 * productos de ASTA, con cantidad, precio y subtotal. Solo ASTA: las líneas de
 * otras marcas del mismo pedido no se enseñan (decidido con Supricom el
 * 2026-11-10). La comparten administración y vendedor; el vendedor solo abre
 * las de su cartera.
 */

const ESTADO: Record<string, string> = { abierta: 'Abierta', confirmada: 'Confirmada · ya es pedido', cancelada: 'Cancelada' };
const ODOO_URL = process.env.ODOO_URL ?? '';

export async function DetalleCotizacion({ sesion, id, alcance, volver }: { sesion: Session; id: number; alcance: 'empresa' | 'cartera'; volver: string }) {
  if (!Number.isInteger(id) || id <= 0) notFound();
  let c;
  try {
    c = await getCotizacion(sesion.accessToken, id, alcance);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Marco usuario={sesion.usuario} titulo="Cotización">
        <div className="notice error">
          <h2>No se pudo cargar la cotización</h2>
          <p>{error instanceof Error ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }
  const unidades = c.lineas.reduce((s, l) => s + l.cantidad, 0);
  const vencida = c.vence !== null && c.vence < new Date().toISOString().slice(0, 10);

  return (
    <Marco usuario={sesion.usuario} titulo={`Cotización ${c.folio}`}>
      <div className="panel ficha-cabeza">
        <div className="ficha-datos">
          <div className="crumb">
            <Link href={volver}>Cotizaciones</Link> <span>/</span> <span>{c.folio}</span>
          </div>
          <span className="ficha-tarifa">
            <Link href={`/cartera/${c.partnerId}`} className="enlace-ficha" data-privado>
              {c.cliente}
            </Link>
            {c.vendedor && (
              <>
                {' · '}
                <span data-privado>{c.vendedor}</span>
              </>
            )}
          </span>
          <span className="stat-sub">
            {ESTADO[c.estado]} · creada el {fecha(c.fecha)}
            {c.vence ? ` · ${vencida ? 'venció' : 'vale hasta'} el ${fecha(c.vence)}` : ''}
          </span>
        </div>
        {ODOO_URL && (
          <div className="ficha-acciones">
            <a className="ficha-odoo" href={`${ODOO_URL}/web#id=${c.id}&model=sale.order&view_type=form`} target="_blank" rel="noopener noreferrer">
              Abrir en Odoo ↗
            </a>
          </div>
        )}
      </div>

      <section className="stats">
        <Cifra icono="ventas" etiqueta="ASTA en la cotización" valor={money(c.importeAsta)} nota="sin IVA" />
        <Cifra icono="ticket" color="violeta" etiqueta="Productos ASTA" valor={c.lineas.length.toLocaleString('es-VE')} nota={`${unidades.toLocaleString('es-VE')} unidades`} />
        {c.estado === 'abierta' ? (
          <Cifra
            icono="reloj"
            color="ambar"
            etiqueta="Esperando"
            valor={c.dias === 1 ? '1 día' : `${c.dias.toLocaleString('es-VE')} días`}
            tono={c.dias > DIAS_SIN_RESPUESTA ? 'atencion' : undefined}
            nota={c.dias > DIAS_SIN_RESPUESTA ? 'sin respuesta: toca llamar al cliente' : 'desde que se creó'}
          />
        ) : (
          <Cifra icono="mes" color="verde" etiqueta="Estado" valor={c.estado === 'confirmada' ? 'Pedido' : 'Cancelada'} nota={`hace ${c.dias.toLocaleString('es-VE')} días`} />
        )}
      </section>

      <section className="panel">
        <h2>Productos de ASTA</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio</th>
                <th className="num">Descuento</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {c.lineas.map((l, i) => (
                <tr key={`${l.productId}-${i}`}>
                  <td>
                    {l.sku && <span className="rp-sku">{l.sku}</span>} {l.nombre}
                  </td>
                  <td className="num">{l.cantidad.toLocaleString('es-VE')}</td>
                  <td className="num">{money(l.precio)}</td>
                  <td className="num">{l.descuento ? `${l.descuento.toLocaleString('es-VE')} %` : '—'}</td>
                  <td className="num">
                    <strong>{money(l.subtotal)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-nota">Precios sin IVA. Solo los productos de la marca ASTA del pedido.</p>
      </section>
    </Marco>
  );
}
