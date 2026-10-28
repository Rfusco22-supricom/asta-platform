import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getActividadCartera, getPortfolio, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { moneyCompact, money } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';
import { TablaCartera, type ResultadoActividad } from './TablaCartera';

/**
 * Cartera del vendedor.
 *
 * Server Component: los datos se piden desde el servidor de Next, así que el
 * navegador nunca habla con el middleware y el token no sale del servidor.
 */

export const dynamic = 'force-dynamic';

export default async function CarteraPage() {
  const sesion = await requireSession();

  /*
   * La actividad se pide YA y no se espera: viaja a la tabla como promesa y
   * llega cuando llegue (ver `TablaCartera`). Nunca rechaza —un fallo se
   * convierte en un mensaje—, porque una promesa rechazada a medio streaming
   * tumbaría la página entera por una columna.
   */
  const actividad: Promise<ResultadoActividad> = getActividadCartera(sesion.accessToken).then(
    (a) => ({ ok: true as const, actividad: a }),
    (error: unknown) => ({
      ok: false as const,
      mensaje: error instanceof ApiError || error instanceof ContractError ? error.message : 'el servidor no respondió.',
    }),
  );

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
    // Un cliente que escribe /cartera recibe 403: el mismo aviso que el resto
    // de pantallas de vendedor, no la ayuda de un fallo de conexión.
    const esPermiso = error instanceof ApiError && error.status === 403;
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
            {esPermiso
              ? 'Esta pantalla es para vendedores'
              : 'No se pudieron cargar los datos'}
          </h2>
          <p>{mensaje}</p>
        </div>
      </Marco>
    );
  }

  const { filas, meta } = portfolio;
  // Con al menos una factura con ASTA, la misma regla que separa a los
  // prospectos en la clasificación de abajo. `esCliente` (el `customer_rank` de
  // Odoo) se enciende también con un pedido confirmado sin facturar.
  const conHistorial = filas.filter((f) => f.numeroFacturas > 0).length;
  const conDeuda = filas.filter((f) => f.porCobrar > 0).length;
  const mayor = filas.reduce<number>((m, f) => Math.max(m, f.totalFacturado), 0);

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Mi cartera"
    >
      <section className="stats">
        <Cifra icono="ventas" etiqueta="Vendido en ASTA" valor={moneyCompact(meta.totalCartera)} nota={`histórico · ${money(meta.totalCartera)}`} />
        <Cifra
          icono="cobrar"
          color="ambar"
          etiqueta="Por cobrar"
          valor={moneyCompact(meta.porCobrarCartera)}
          tono={meta.porCobrarCartera > 0 ? 'alerta' : undefined}
          nota={`a hoy · ${conDeuda} clientes con saldo en facturas con ASTA`}
        />
        <Cifra icono="clientes" color="verde" etiqueta="Compran ASTA" valor={conHistorial} nota={`${filas.length - conHistorial} todavía sin comprar ASTA`} />
        <Cifra
          icono="corona"
          color="violeta"
          etiqueta="Mayor cliente"
          valor={moneyCompact(mayor)}
          pequena
          nota={meta.totalCartera > 0 ? `histórico · ${((mayor / meta.totalCartera) * 100).toFixed(0)} % de la cartera` : '—'}
        />
      </section>

      <TablaCartera filas={filas} actividad={actividad} />
    </Marco>
  );
}
