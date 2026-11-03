import { getOfertaCliente, esRedireccion } from '@/lib/api';

/**
 * La próxima mejor oferta: los productos ASTA que compran sus clientes
 * parecidos y él todavía no (ver `proximaOferta.ts` en shared-types). Va en su
 * propio `Suspense`: la primera vez lee las compras de todos los clientes y
 * tarda unos segundos, y la ficha no tiene que esperarla.
 */

const n = (x: number) => x.toLocaleString('es-VE', { maximumFractionDigits: 1 });

export async function Oferta({ token, partnerId }: { token: string; partnerId: number }) {
  let o;
  try {
    o = await getOfertaCliente(token, partnerId);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    // Sin oferta, la ficha sigue: es una ayuda, no un dato del cliente.
    return null;
  }
  if (o.productos.length === 0) return null;

  const parecidos = o.basadoEn === 'PARECIDOS';
  return (
    <section className="panel oferta">
      <h2>Próxima mejor oferta</h2>
      <p className="panel-nota">
        {parecidos
          ? `Lo compran sus clientes parecidos (los ${o.comparadoCon} que más coinciden con los ${o.compraAsta} productos ASTA que compra) y él todavía no.`
          : 'Todavía no compra ASTA: estos son los más vendidos, para empezar.'}
      </p>
      <ol className="oferta-lista">
        {o.productos.map((p) => (
          <li key={p.productId}>
            <div className="oferta-producto">
              <strong>{p.nombre.replace(/^ASTA\s+/i, '')}</strong>
              {p.sku && <span className="sku">{p.sku}</span>}
            </div>
            <span className="stat-sub">
              {parecidos ? `Lo compran ${p.clientes} de sus ${o.comparadoCon} parecidos` : `Lo compran ${p.clientes} clientes`} · {n(p.unidadesMes)} u./mes cada uno
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
