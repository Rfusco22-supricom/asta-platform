import type { ClientProfile } from '@asta/shared-types';
import { money, fecha } from '@/lib/formato';
import { Notas } from './Notas';

/**
 * Bloque de perfilado (issue #24).
 *
 * Responde a lo que el vendedor necesita antes de descolgar el teléfono:
 * cuánto hace que este cliente no compra y qué le suele comprar.
 */

const RECENCIA_TEXTO: Record<ClientProfile['estadoRecencia'], string> = {
  activo: 'Compra ASTA con regularidad',
  atencion: 'Lleva tiempo sin comprar ASTA',
  inactivo: 'Ya no compra ASTA',
  sin_compras: 'Nunca ha comprado ASTA',
};

export function Perfil({ perfil }: { perfil: ClientProfile }) {
  const { estadoRecencia: estado, diasSinComprar: dias, umbrales } = perfil;
  const maxMonto = perfil.topProductos[0]?.monto ?? 0;

  return (
    <>
      <section className="panel">
        <h2>Actividad</h2>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span className={`recencia ${estado}`}>
            <span className="punto" />
            {dias === null
              ? RECENCIA_TEXTO.sin_compras
              : `${dias} ${dias === 1 ? 'día' : 'días'} sin comprar ASTA`}
          </span>
          <span className="recencia-nota">
            {RECENCIA_TEXTO[estado]}
            {perfil.ultimaCompra && ` · última compra de ASTA el ${fecha(perfil.ultimaCompra)}`}
          </span>
        </div>

        {/* Los umbrales se muestran para que el color no parezca arbitrario.
            Si el vendedor no sabe por qué algo está en rojo, deja de mirarlo. */}
        <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
          Se marca en ámbar a partir de {umbrales.atencion} días y en rojo a partir de{' '}
          {umbrales.inactivo}. Umbrales pendientes de confirmar con el área comercial.
        </p>
      </section>

      <section className="panel">
        <h2>Qué compra de ASTA</h2>

        {perfil.topProductos.length === 0 ? (
          <div className="empty" style={{ padding: '28px 20px' }}>
            Todavía no ha comprado productos ASTA.
          </div>
        ) : (
          <>
            <div className="table-wrap" style={{ border: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {perfil.topProductos.map((p) => (
                    <tr key={p.productId}>
                      <td>
                        <div className="cliente-nombre">{p.nombre}</div>
                        {p.sku && <div className="sku">{p.sku}</div>}
                      </td>
                      <td className="num">{p.cantidad.toLocaleString('es-VE')}</td>
                      <td className="num barra-celda">
                        <span
                          className="relleno"
                          style={{
                            width: maxMonto > 0 ? `${(p.monto / maxMonto) * 100}%` : '0%',
                            right: 0,
                            left: 'auto',
                          }}
                        />
                        <span className="texto">{money(p.monto)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
              Top {perfil.topProductos.length} de {perfil.productosDistintos} productos ASTA
              distintos · {money(perfil.montoEnProductos)} <strong>sin impuestos</strong>, de todo su
              historial: si arriba hay un periodo elegido, las cifras no tienen por qué cuadrar.
            </p>
          </>
        )}
      </section>

      <Notas
        partnerId={perfil.partnerId}
        notas={perfil.notas}
        disponibles={perfil.notasDisponibles}
      />
    </>
  );
}
