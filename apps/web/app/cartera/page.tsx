import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getPortfolio, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact, money } from '@/lib/formato';
import { TablaCartera } from './TablaCartera';

/**
 * Cartera del vendedor.
 *
 * Server Component: los datos se piden desde el servidor de Next, así que el
 * navegador nunca habla con el middleware y el token no sale del servidor.
 */

export const dynamic = 'force-dynamic';

export default async function CarteraPage() {
  const sesion = await requireSession();

  let portfolio;
  try {
    portfolio = await getPortfolio(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga y
    // el usuario ve "no se pudo cargar" en vez de ir al login.
    if (esRedireccion(error)) throw error;
    // Odoo caído no puede dar pantalla en blanco: el vendedor tiene que
    // entender qué pasa y si es culpa suya.
    const esContrato = error instanceof ContractError;
    const mensaje =
      error instanceof ApiError
        ? error.message
        : esContrato
          ? (error as ContractError).message
          : 'Error inesperado.';

    return (
      <Marco usuario={sesion.usuario} titulo="Mi cartera">
        <div className="notice error">
          <h2>
            {esContrato ? 'El panel y la API no se entienden' : 'No se pudieron cargar los datos'}
          </h2>
          <p>{mensaje}</p>
          {esContrato ? (
            <p style={{ marginTop: 10 }}>
              Es un fallo de programación, no de conexión: el middleware está devolviendo una forma
              distinta a la que declara el contrato.
            </p>
          ) : (
            <p style={{ marginTop: 10 }}>
              Comprueba que el middleware esté arriba con <code>pnpm dev:middleware</code> y que
              Odoo responda.
            </p>
          )}
        </div>
      </Marco>
    );
  }

  const { filas, meta } = portfolio;
  const conHistorial = filas.filter((f) => f.esCliente).length;
  const conDeuda = filas.filter((f) => f.porCobrar > 0).length;
  const mayor = filas.reduce<number>((m, f) => Math.max(m, f.totalFacturado), 0);

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Mi cartera"
      descripcion={`${meta.clientes} clientes asignados · datos en vivo desde Odoo, en moneda de la compañía`}
    >
      <section className="stats">
        <div className="stat">
          <div className="stat-label">Total facturado</div>
          <div className="stat-value">{moneyCompact(meta.totalCartera)}</div>
          <div className="stat-sub">{money(meta.totalCartera)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Por cobrar</div>
          <div
            className="stat-value"
            style={{
              color: meta.porCobrarCartera > 0 ? 'var(--danger)' : undefined,
            }}
          >
            {moneyCompact(meta.porCobrarCartera)}
          </div>
          <div className="stat-sub">{conDeuda} clientes con saldo</div>
        </div>
        <div className="stat">
          <div className="stat-label">Con historial</div>
          <div className="stat-value">{conHistorial}</div>
          <div className="stat-sub">{filas.length - conHistorial} prospectos sin comprar</div>
        </div>
        <div className="stat">
          <div className="stat-label">Mayor cliente</div>
          <div className="stat-value small">{moneyCompact(mayor)}</div>
          <div className="stat-sub">
            {meta.totalCartera > 0
              ? `${((mayor / meta.totalCartera) * 100).toFixed(0)} % de la cartera`
              : '—'}
          </div>
        </div>
      </section>

      <TablaCartera filas={filas} />
    </Marco>
  );
}
