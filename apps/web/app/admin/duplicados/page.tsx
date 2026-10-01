import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getDuplicadosInforme, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { money, moneyCompact, fechaHora } from '@/lib/formato';

/**
 * Clientes duplicados: qué fusiones arreglan las cifras del panel (#50).
 *
 * ── Por qué esta pantalla y no el número del issue ───────────────────────────
 *
 * El issue dice «61,8 % de los registros de cliente están duplicados». Con ese
 * número no se puede hacer nada —suena a una migración de semanas— y por eso
 * lleva meses parado. Lo que sí se puede hacer es la lista corta: los grupos
 * donde la facturación está REPARTIDA, ordenados por dinero, con el registro
 * destino marcado y un enlace para abrir cada uno en Odoo.
 *
 * ── La fusión no se hace aquí, y es deliberado ───────────────────────────────
 *
 * Fusionar dos clientes no se deshace, toca facturación emitida y mueve comisión
 * de una cartera a otra. Un botón «fusionar» en el panel convertiría eso en un
 * clic, y la mayoría de estos grupos cruzan carteras: la conversación tiene que
 * pasar antes. El panel dice por dónde empezar, cuánto queda, y abre el registro
 * en Odoo, que es donde la operación tiene deshacer, permisos y registro.
 *
 * ── Por qué encoge ───────────────────────────────────────────────────────────
 *
 * Se recalcula de Odoo, no de una foto guardada. Cada fusión hecha desaparece de
 * la lista en la siguiente carga, y eso —no un porcentaje— es lo que hace que
 * una tarea de 139 grupos se termine.
 */

export const dynamic = 'force-dynamic';

const ODOO_URL = process.env.ODOO_URL ?? '';

/** Cuántos grupos se pintan sin pedirlo. Los demás, tras `?ver=todos`. */
const POR_DEFECTO = 30;

function odooUrl(partnerId: number): string {
  return `${ODOO_URL}/web#id=${partnerId}&model=res.partner&view_type=form`;
}

export default async function DuplicadosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>;
}) {
  const sesion = await requireSession();
  const { ver } = await searchParams;

  let datos;
  try {
    datos = await getDuplicadosInforme(sesion.accessToken);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
    if (esRedireccion(error)) throw error;

    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Clientes duplicados">
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

  const { grupos, resumen, fusionesPara, generadoEn } = datos;
  const pct =
    resumen.montoTotalFacturado > 0
      ? (resumen.montoPartido / resumen.montoTotalFacturado) * 100
      : 0;
  const inofensivos = resumen.sinFacturas + resumen.inocuos;
  const todos = ver === 'todos';
  const visibles = todos ? grupos : grupos.slice(0, POR_DEFECTO);
  const objetivo = fusionesPara.find((f) => f.porcentaje === 90);

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Clientes duplicados"
      descripcion={`${resumen.registros.toLocaleString('es-VE')} clientes examinados · leído de Odoo el ${fechaHora(generadoEn)}`}
    >
      <section className="stats">
        <div className="stat">
          <div className="stat-label">Facturación mal repartida</div>
          <div className="stat-value" style={{ color: resumen.montoPartido > 0 ? 'var(--danger)' : undefined }}>
            {moneyCompact(resumen.montoPartido)}
          </div>
          <div className="stat-sub">{pct.toFixed(1)} % de lo facturado, en cifras que nadie ve completas</div>
        </div>
        <div className="stat">
          <div className="stat-label">Fusiones pendientes</div>
          <div className="stat-value">{resumen.partidos.toLocaleString('es-VE')}</div>
          <div className="stat-sub">grupos con la facturación partida en varios registros</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cruzan carteras</div>
          <div className="stat-value" style={{ color: resumen.partidosEntreVendedores > 0 ? 'var(--warning)' : undefined }}>
            {resumen.partidosEntreVendedores.toLocaleString('es-VE')}
          </div>
          <div className="stat-sub">fusionarlos mueve facturación entre vendedores</div>
        </div>
        <div className="stat">
          <div className="stat-label">Duplicados inofensivos</div>
          <div className="stat-value">{inofensivos.toLocaleString('es-VE')}</div>
          <div className="stat-sub">
            {resumen.sinFacturas} sin facturas y {resumen.inocuos} con todo en un registro: el panel muestra bien
          </div>
        </div>
      </section>

      {resumen.partidos === 0 ? (
        <div className="notice">
          <h2>No hay ningún cliente con la facturación repartida</h2>
          <p>
            Quedan {inofensivos} grupos de nombres o RIF repetidos, pero ninguno distorsiona las
            cifras del panel: o no tienen facturas, o las tienen todas en un mismo registro.
            Nada que fusionar por este motivo.
          </p>
        </div>
      ) : (
        <>
          {/*
            El número que convierte el issue en una tarea con final.
            «Hay 139 grupos rotos» no mueve a nadie; «con 20 fusiones arreglas el
            90 % del dinero» sí, porque se puede terminar en una tarde.
          */}
          <section className="panel">
            <h2>Por dónde empezar</h2>
            <p className="panel-nota">
              La lista va ordenada por dinero en juego, no por número de registros.
              {objetivo && objetivo.fusiones > 0 && (
                <>
                  {' '}
                  Con las <strong>{objetivo.fusiones} primeras</strong> se arregla el 90 % de la
                  facturación mal repartida.
                </>
              )}
            </p>
            <ul className="duplicados-escalera">
              {fusionesPara.map((f) => (
                <li key={f.porcentaje}>
                  <strong>{f.fusiones}</strong> {f.fusiones === 1 ? 'fusión' : 'fusiones'}
                  <span> cubren el {f.porcentaje} %</span>
                </li>
              ))}
            </ul>
            <p className="panel-nota">
              Cada fusión se hace en Odoo: <strong>Contactos → selecciona los registros → Acción →
              Fusionar contactos</strong>, dejando como destino el marcado aquí. Odoo reasigna
              facturas y pedidos al superviviente. Esta lista se recalcula en cada carga, así que
              lo fusionado desaparece de ella.
            </p>
          </section>

          <div className="toolbar">
            <span className="count">
              {visibles.length.toLocaleString('es-VE')} de {grupos.length.toLocaleString('es-VE')} grupos
              {!todos && grupos.length > POR_DEFECTO && (
                <>
                  {' · '}
                  <Link href="/admin/duplicados?ver=todos">ver todos</Link>
                </>
              )}
            </span>
          </div>

          <div className="table-wrap">
            <table className="tabla-duplicados">
              <thead>
                <tr>
                  <th>Cliente y sus registros</th>
                  <th className="num">Facturado</th>
                  <th className="num">Facturas</th>
                  <th>Cartera</th>
                  <th />
                </tr>
              </thead>

              {/*
                Un `tbody` por grupo: la fila de cabecera lleva el total del
                cliente real y las de dentro, cada registro. Con una sola tabla
                plana no se distingue qué suma con qué, que es justo lo que hay
                que ver antes de fusionar.
              */}
              {visibles.map((g, i) => (
                <tbody key={`${g.motivo}|${g.clave}`} className="duplicados-grupo">
                  <tr className="duplicados-cabecera">
                    <td>
                      <span className="duplicados-orden">{i + 1}</span>
                      <span className="cliente-nombre">{g.registros[0].nombre}</span>
                      <div className="duplicados-meta">
                        <span className={`tag ${g.motivo === 'rif' ? 'estado-validada' : 'prospecto'}`}>
                          {g.motivo === 'rif' ? `mismo RIF · ${g.clave}` : 'mismo nombre'}
                        </span>
                        {g.vendedores.length > 1 && (
                          <span className="duplicados-aviso">
                            ⚠ {g.vendedores.length} vendedores: fusionar mueve comisión
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">
                      <strong>{money(g.montoTotal)}</strong>
                      <div className="stat-sub">{money(g.montoFuera)} fuera del destino</div>
                    </td>
                    <td className="num">
                      {g.conFacturas}/{g.registros.length}
                      <div className="stat-sub">con facturas</div>
                    </td>
                    <td colSpan={2} />
                  </tr>

                  {g.registros.map((r) => (
                    <tr key={r.partnerId} className={r.esDestino ? 'duplicados-destino' : undefined}>
                      <td>
                        <span className="duplicados-id">id {r.partnerId}</span> {r.nombre}
                        {r.esDestino && <span className="duplicados-flecha">← fusionar aquí</span>}
                      </td>
                      <td className={`num${r.facturado === 0 ? ' zero' : ''}`}>{money(r.facturado)}</td>
                      <td className={`num${r.facturas === 0 ? ' zero' : ''}`}>{r.facturas}</td>
                      <td>{r.vendedorNombre ?? <span className="stat-sub">sin vendedor</span>}</td>
                      <td>
                        {ODOO_URL && (
                          <a
                            className="enlace-accion"
                            href={odooUrl(r.partnerId)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Odoo ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          {!todos && grupos.length > POR_DEFECTO && (
            <nav className="paginacion">
              <span />
              <Link href="/admin/duplicados?ver=todos">
                Ver los {grupos.length - POR_DEFECTO} grupos restantes →
              </Link>
              <span />
            </nav>
          )}

          {/*
            Lo que esta pantalla NO puede arreglar.

            Sin regla de unicidad en Odoo, cada semana entran duplicados nuevos y
            la lista vuelve a crecer sola. Decirlo aquí es lo que evita que
            alguien fusione 139 grupos y dé el problema por cerrado.
          */}
          <div className="notice" style={{ marginTop: 18 }}>
            <h2>Fusionar no evita que vuelvan</h2>
            <p>
              Mientras en Odoo se pueda crear un cliente con un RIF que ya existe, la lista vuelve
              a llenarse. La prevención es del lado de Odoo: subir el documento fiscal a{' '}
              <code>res.partner</code> y hacerlo único. Es el punto 3 del issue #50 y no se puede
              hacer desde el panel.
            </p>
          </div>
        </>
      )}
    </Marco>
  );
}
