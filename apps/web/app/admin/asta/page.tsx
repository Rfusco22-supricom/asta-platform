import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getAstaEmpresa, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact } from '@/lib/formato';
import { TablaAsta } from './TablaAsta';

/**
 * Marca ASTA: cuánto del consumible que compran nuestros clientes es nuestro.
 *
 * ── Qué se compara, y qué no ─────────────────────────────────────────────────
 *
 * Solo las categorías donde ASTA fabrica —CONSUMIBLES y GENERAL—. Medir la cuota
 * de ASTA en ROUTERING sería dividir por una oportunidad que no existe: ahí el
 * cliente no está eligiendo otra marca, es que ASTA no hace eso.
 *
 * ── La cifra que importa ─────────────────────────────────────────────────────
 *
 * No es la cuota del 11,9 %, que es un titular. Es que 860 clientes compran
 * consumibles cada mes y no han probado ASTA ni una vez. Esa lista tiene nombres
 * y vendedor asignado, y es la única parte de esta pantalla sobre la que alguien
 * puede hacer algo mañana.
 */

export const dynamic = 'force-dynamic';

export default async function AstaPage() {
  const sesion = await requireSession();

  let datos;
  try {
    datos = await getAstaEmpresa(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Marca ASTA">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>
            {error instanceof ContractError || error instanceof ApiError
              ? error.message
              : 'Error inesperado.'}
          </p>
        </div>
      </Marco>
    );
  }

  const { filas, totales } = datos;

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Marca ASTA"
      descripcion={`Consumibles facturados a ${totales.clientes.toLocaleString('es-VE')} clientes, comparando ASTA con HP, Canon, Epson y Brother · leído en ${(datos.duracionMs / 1000).toFixed(1)} s`}
    >
      <section className="stats">
        <div className="stat">
          <div className="stat-label">CUOTA DE ASTA</div>
          <div className="stat-value">{totales.cuota.toFixed(1)} %</div>
          <div className="stat-sub">del consumible que compran nuestros clientes</div>
        </div>
        <div className="stat">
          <div className="stat-label">VENDIDO EN ASTA</div>
          <div className="stat-value" style={{ color: 'var(--positive)' }}>
            {moneyCompact(totales.asta)}
          </div>
          <div className="stat-sub">marca propia</div>
        </div>
        <div className="stat">
          <div className="stat-label">A LA COMPETENCIA</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>
            {moneyCompact(totales.competencia)}
          </div>
          <div className="stat-sub">mismo tipo de producto, otra marca</div>
        </div>
        <div className="stat">
          <div className="stat-label">SIN PROBAR ASTA</div>
          <div className="stat-value" style={{ color: 'var(--warning)' }}>
            {totales.sinAsta.toLocaleString('es-VE')}
          </div>
          <div className="stat-sub">clientes · {moneyCompact(totales.sinAstaImporte)} fuera</div>
        </div>
      </section>

      {/*
        El aviso dice qué hacer, no solo cuánto se pierde.
        Un número grande en rojo sin siguiente paso se convierte en parte del
        decorado a la tercera vez que se ve.
      */}
      {totales.sinAsta > 0 && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <h2>
            {totales.sinAsta} clientes compran consumibles y no han probado ASTA
          </h2>
          <p>
            Se llevan {moneyCompact(totales.sinAstaImporte)} a otras marcas. Cada uno tiene su
            vendedor asignado en la tabla: es la conversación más fácil de tener, porque no hay
            que convencer de cambiar sino de probar una vez.
          </p>
        </div>
      )}

      <TablaAsta filas={filas} conVendedor />
    </Marco>
  );
}
