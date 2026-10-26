import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { PestanasSeccion, PESTANAS_ODOO } from '@/components/PestanasSeccion';
import { Marco } from '@/components/Marco';
import { getDuplicadosInforme, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { money, moneyCompact } from '@/lib/formato';
import { Cifra } from '@/components/Cifras';

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
      <Marco usuario={sesion.usuario} titulo="Datos de Odoo">
        <PestanasSeccion etiqueta="Datos de Odoo" pestanas={PESTANAS_ODOO} actual="/admin/duplicados" />
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

  const { grupos, resumen, fusionesPara } = datos;
  const pct =
    resumen.montoTotalFacturado > 0
      ? (resumen.montoPartido / resumen.montoTotalFacturado) * 100
      : 0;
  const inofensivos = resumen.sinFacturas + resumen.inocuos;
  const todos = ver === 'todos';
  const visibles = todos ? grupos : grupos.slice(0, POR_DEFECTO);

  return (
    <Marco usuario={sesion.usuario} titulo="Datos de Odoo">
      <PestanasSeccion etiqueta="Datos de Odoo" pestanas={PESTANAS_ODOO} actual="/admin/duplicados" />
      <section className="stats">
        <Cifra
          icono="juego"
          color="rosa"
          etiqueta="Facturación mal repartida"
          valor={moneyCompact(resumen.montoPartido)}
          tono={resumen.montoPartido > 0 ? 'alerta' : undefined}
          nota={`${pct.toFixed(1)} % de lo facturado`}
        />
        <Cifra icono="copias" color="violeta" etiqueta="Fusiones pendientes" valor={resumen.partidos.toLocaleString('es-VE')} nota="grupos" />
        <Cifra
          icono="clientes"
          color="ambar"
          etiqueta="Cruzan carteras"
          valor={resumen.partidosEntreVendedores.toLocaleString('es-VE')}
          tono={resumen.partidosEntreVendedores > 0 ? 'atencion' : undefined}
          nota="entre vendedores"
        />
        <Cifra
          icono="check"
          color="verde"
          etiqueta="Duplicados inofensivos"
          valor={inofensivos.toLocaleString('es-VE')}
          nota="no afectan a las cifras"
        />
      </section>

      {resumen.partidos === 0 ? (
        <div className="empty">Nada que fusionar.</div>
      ) : (
        <>
          <section className="panel">
            <h2>Por dónde empezar</h2>
            <ul className="duplicados-escalera">
              {fusionesPara.map((f) => (
                <li key={f.porcentaje}>
                  <strong>{f.fusiones}</strong> {f.fusiones === 1 ? 'fusión' : 'fusiones'}
                  <span> cubren el {f.porcentaje} %</span>
                </li>
              ))}
            </ul>
            <ol className="cd-ruta" aria-label="Dónde se fusiona en Odoo">
              <li>Contactos</li>
              <li>Seleccionar</li>
              <li>Acción</li>
              <li>Fusionar contactos</li>
            </ol>
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
                <tbody key={`${g.compania ?? ""}|${g.motivo}|${g.clave}`} className="duplicados-grupo">
                  <tr className="duplicados-cabecera">
                    <td>
                      <span className="duplicados-orden">{i + 1}</span>
                      <span className="cliente-nombre">{g.registros[0].nombre}</span>
                      <div className="duplicados-meta">
                        <span className={`tag ${g.motivo === 'rif' ? 'estado-validada' : 'prospecto'}`}>
                          {g.motivo === 'rif' ? `mismo RIF · ${g.clave}` : 'mismo nombre'}
                        </span>
                        {/* Se agrupa dentro de cada compañía: decir cuál evita fusionar en la que no es. */}
                        <span className="tag">{g.compania ?? 'Ficha compartida'}</span>
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

        </>
      )}
    </Marco>
  );
}
