import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Periodos } from '@/components/Periodos';
import { getEstadisticasRecomendador, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { fechaCorta } from '@/lib/formato';
import { BusquedasSinResultado } from './BusquedasSinResultado';

/**
 * Qué buscan los clientes en el recomendador, y dónde se pierde la venta (#43).
 *
 * Las tres cosas que esta pantalla tiene que contestar, por orden:
 *
 *   1. ¿Qué se busca y no se encuentra? Esa lista ES la de alias que faltan, y
 *      por eso cada fila trae el botón para atarla a una impresora.
 *   2. ¿Dónde hay producto compatible pero sin existencias? Son ventas perdidas
 *      con nombre y apellido.
 *   3. ¿Qué se mira y qué se pulsa?
 *
 * El endpoint es de Lino (#117); aquí solo se pinta.
 */

export const dynamic = 'force-dynamic';

function Metrica({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: string; nota?: string; tono?: 'mal' | 'atencion' | 'bien' }) {
  const color = tono === 'mal' ? 'var(--danger)' : tono === 'atencion' ? 'var(--warning)' : tono === 'bien' ? 'var(--positive)' : undefined;
  return (
    <div className="stat">
      <div className="stat-label">{etiqueta}</div>
      <div className="stat-value" style={{ color }}>
        {valor}
      </div>
      {nota && <div className="stat-sub">{nota}</div>}
    </div>
  );
}

const pct = (parte: number, total: number) => (total > 0 ? `${Math.round((parte / total) * 100)} %` : '—');
const num = (n: number) => n.toLocaleString('es-VE');

export default async function RecomendadorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requireSession();
  const params = await searchParams;
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  // Las dos o ninguna: el middleware rechaza una sola, y aquí se evita el viaje.
  const rango = desde && hasta ? { desde, hasta } : undefined;

  let datos;
  try {
    datos = await getEstadisticasRecomendador(sesion.accessToken, rango);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Recomendador">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const { totales, sinResultado, impresoras, productos } = datos;
  const hayAlgo = totales.busquedas > 0 || totales.consultasDirectas > 0;

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Recomendador"
      descripcion={`Qué buscan los clientes en el kiosco · ${datos.desde} a ${datos.hasta}`}
    >
      <Periodos base="/admin/recomendador" periodo={{ desde: datos.desde, hasta: datos.hasta }} />

      {!hayAlgo ? (
        <div className="notice">
          <h2>No hay búsquedas en este periodo</h2>
          <p>
            Entre el {datos.desde} y el {datos.hasta} nadie usó el recomendador. Se registra desde que el kiosco o una
            integración empiezan a consultarlo; prueba con un rango más amplio.
          </p>
        </div>
      ) : (
        <>
          <section className="stats">
            <Metrica etiqueta="Búsquedas" valor={num(totales.busquedas)} nota={`${num(totales.consultasDirectas)} consultas directas, sin buscar`} />
            <Metrica
              etiqueta="Sin resultado"
              valor={num(totales.sinResultado)}
              nota={`${pct(totales.sinResultado, totales.busquedas)} de las búsquedas`}
              tono={totales.sinResultado > 0 ? 'atencion' : undefined}
            />
            <Metrica
              etiqueta="Acabaron en un clic"
              valor={num(totales.conClic)}
              nota={`${pct(totales.conClic, totales.busquedas)} de las búsquedas`}
              tono={totales.conClic > 0 ? 'bien' : undefined}
            />
            <Metrica
              etiqueta="Quiebres de stock"
              valor={num(totales.quiebres)}
              nota="había tóner compatible y ninguno en existencia"
              tono={totales.quiebres > 0 ? 'mal' : undefined}
            />
          </section>

          {/*
            Lo primero de la pantalla, y con acción: cada línea es una venta que
            no ocurrió porque el recomendador no supo qué impresora era.
          */}
          <section className="panel">
            <h2>Búsquedas sin resultado</h2>
            <p className="formulario-nota">
              Lo que la gente teclea y el recomendador no encuentra. Casi siempre no falta producto: falta el alias.
              Átalo a su impresora y la misma búsqueda empieza a funcionar.
            </p>
            {sinResultado.length === 0 ? (
              <div className="empty">Ninguna búsqueda se quedó sin resultado en este periodo.</div>
            ) : (
              <BusquedasSinResultado busquedas={sinResultado} />
            )}
          </section>

          <section className="panel">
            <h2>Impresoras más buscadas</h2>
            {impresoras.length === 0 ? (
              <div className="empty">Todavía no se ha elegido ninguna impresora.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Impresora</th>
                      <th className="num">Veces</th>
                      <th className="num">Quiebres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impresoras.map((i) => (
                      <tr key={i.printerModelId}>
                        <td>
                          {i.nombre ? (
                            <>
                              <span className="impresora-nombre">{i.nombre}</span>
                              {i.marca && <div className="sku">{i.marca}</div>}
                            </>
                          ) : (
                            // La impresora se retiró del catálogo después de la búsqueda.
                            <em>impresora #{i.printerModelId}, ya no está</em>
                          )}
                        </td>
                        <td className="num">{num(i.veces)}</td>
                        <td className={`num${i.quiebres > 0 ? ' debt' : ' zero'}`}>{i.quiebres > 0 ? num(i.quiebres) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Productos más pulsados</h2>
            {productos.length === 0 ? (
              <div className="empty">Todavía nadie ha pulsado un producto.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="num">Clics</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((p) => (
                      <tr key={p.productId}>
                        <td>
                          {/* `nombre` viene vacío si Odoo no respondió: el resto del informe sale igual. */}
                          {p.nombre ?? <em>producto #{p.productId}</em>}
                          {p.sku && <div className="sku">{p.sku}</div>}
                        </td>
                        <td className="num">{num(p.clics)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="pie-criterio">
            Las listas traen hasta 20 filas. Última búsqueda sin resultado registrada:{' '}
            {sinResultado[0] ? fechaCorta(sinResultado[0].ultimaVez) : '—'}.
          </p>
        </>
      )}
    </Marco>
  );
}
