import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession, clearSession } from '@/lib/session';
import { getReconciliacion, getSinAcceso, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Invitaciones } from './Invitaciones';

/**
 * Panel del administrador: reconciliación Odoo ↔ middleware (issue #19).
 *
 * Contesta de un vistazo lo que nadie mira por separado: cuántos clientes de
 * Odoo NO tienen cuenta y por qué, y cuántos la tienen pero no pueden entrar.
 */

export const dynamic = 'force-dynamic';

async function salir() {
  'use server';
  await clearSession();
  redirect('/login');
}

interface Fila {
  motivo: string;
  total: number;
}

/** Una cifra que puede ser buena o mala según el número. */
function Metrica({
  etiqueta,
  valor,
  nota,
  tono = 'neutro',
}: {
  etiqueta: string;
  valor: number | string;
  nota?: string;
  tono?: 'neutro' | 'bien' | 'atencion' | 'mal';
}) {
  const color =
    tono === 'mal' ? 'var(--danger)' : tono === 'atencion' ? 'var(--warning)' : tono === 'bien' ? 'var(--positive)' : undefined;
  return (
    <div className="stat">
      <div className="stat-label">{etiqueta}</div>
      <div className="stat-value" style={{ color }}>
        {typeof valor === 'number' ? valor.toLocaleString('es-VE') : valor}
      </div>
      {nota && <div className="stat-sub">{nota}</div>}
    </div>
  );
}

export default async function AdminPage() {
  const sesion = await requireSession();

  let r;
  let candidatos: Awaited<ReturnType<typeof getSinAcceso>> = [];
  try {
    // En paralelo y con el de invitaciones degradado por separado: si falla,
    // el informe —que es lo principal— se sigue viendo.
    const [rec, cand] = await Promise.all([
      getReconciliacion(sesion.accessToken),
      getSinAcceso(sesion.accessToken, 25).catch(() => []),
    ]);
    r = rec;
    candidatos = cand;
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga y
    // el usuario ve "no se pudo cargar" en vez de ir al login.
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco nombre={sesion.usuario.nombre}>
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo generar el informe'}</h2>
          <p>
            {error instanceof ContractError || error instanceof ApiError
              ? error.message
              : 'Error inesperado.'}
          </p>
        </div>
      </Marco>
    );
  }

  const rec = r as unknown as {
    odoo: { clientesActivos: number };
    middleware: { usuarios: number; clientes: number; staff: number };
    sinCuenta: { total: number; porMotivo: Record<string, number>; muestra: Array<{ odooPartnerId: number; nombre: string; email: string | null; motivo: string; detalle?: string }> };
    sinCredenciales: { total: number; muestra: Array<{ email: string; nombre: string }> };
    huerfanos: { total: number };
    desalineados: { total: number; muestra: Array<{ odooPartnerId: number; nombre: string; campo: string; enOdoo: string | null; enMiddleware: string | null }> };
    nuncaSincronizados: { total: number; muestra: Array<{ email: string; role: string }> };
    duracionMs: number;
    generadoEn: string;
  };

  const ETIQUETA: Record<string, string> = {
    SIN_EMAIL: 'No tienen correo en Odoo',
    EMAIL_INVALIDO: 'Correo mal escrito en Odoo',
    EMAIL_COMPARTIDO: 'Comparten correo con otro cliente',
    DESCONOCIDO: 'Sin motivo claro — revisar',
  };

  const motivos: Fila[] = Object.entries(rec.sinCuenta.porMotivo)
    .filter(([, v]) => v > 0)
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => b.total - a.total);

  return (
    <Marco nombre={sesion.usuario.nombre}>
      <div className="page-head">
        <h1>Reconciliación con Odoo</h1>
        <p>
          Generado en {(rec.duracionMs / 1000).toFixed(1)} s ·{' '}
          {new Date(rec.generadoEn).toLocaleString('es-VE')}
        </p>
      </div>

      <section className="stats">
        <Metrica etiqueta="Clientes en Odoo" valor={rec.odoo.clientesActivos} nota="activos" />
        <Metrica
          etiqueta="Con cuenta"
          valor={rec.middleware.clientes}
          nota={`${((rec.middleware.clientes / rec.odoo.clientesActivos) * 100).toFixed(0)} % de los clientes`}
          tono="bien"
        />
        <Metrica
          etiqueta="Sin cuenta"
          valor={rec.sinCuenta.total}
          nota="no pueden usar el panel"
          tono={rec.sinCuenta.total > 0 ? 'atencion' : 'bien'}
        />
        <Metrica
          etiqueta="No pueden entrar"
          valor={rec.sinCredenciales.total}
          nota="tienen cuenta, les falta contraseña"
          tono={rec.sinCredenciales.total > 0 ? 'mal' : 'bien'}
        />
      </section>

      {/* Lo más grave primero: cuentas que existen pero no sirven para nada.
          El bloque trae ya la acción que lo resuelve, en vez de un aviso que
          solo dice que hay un problema. */}
      {rec.sinCredenciales.total > 0 && (
        <Invitaciones candidatos={candidatos} total={rec.sinCredenciales.total} />
      )}

      <section className="panel">
        <h2>Por qué {rec.sinCuenta.total} clientes no tienen cuenta</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Motivo</th>
                <th className="num">Clientes</th>
                <th>Qué hacer</th>
              </tr>
            </thead>
            <tbody>
              {motivos.map((m) => (
                <tr key={m.motivo}>
                  <td>{ETIQUETA[m.motivo] ?? m.motivo}</td>
                  <td className="num">{m.total.toLocaleString('es-VE')}</td>
                  <td style={{ color: 'var(--text-3)', fontSize: 12.5 }}>
                    {m.motivo === 'SIN_EMAIL' && 'Añadir correo en Odoo, o dejarlos sin acceso'}
                    {m.motivo === 'EMAIL_INVALIDO' && 'Corregir la dirección en Odoo'}
                    {m.motivo === 'EMAIL_COMPARTIDO' &&
                      'Suelen ser grupos de empresas. Hoy solo uno puede tener cuenta'}
                    {m.motivo === 'DESCONOCIDO' && 'Revisar: debería haberse creado'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rec.sinCuenta.muestra.filter((m) => m.motivo === 'EMAIL_INVALIDO').length > 0 && (
        <section className="panel">
          <h2>Correos mal escritos en Odoo</h2>
          <p style={{ marginTop: -6, marginBottom: 12, fontSize: 13, color: 'var(--text-2)' }}>
            Cada uno es un cliente que no puede entrar por una errata de captura.
          </p>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Lo que hay en Odoo</th>
                </tr>
              </thead>
              <tbody>
                {rec.sinCuenta.muestra
                  .filter((m) => m.motivo === 'EMAIL_INVALIDO')
                  .map((m) => (
                    <tr key={m.odooPartnerId}>
                      <td>
                        <div className="cliente-nombre">{m.nombre}</div>
                        <div className="sku">partner {m.odooPartnerId}</div>
                      </td>
                      <td>
                        <code style={{ fontSize: 12 }}>{m.detalle ?? m.email}</code>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stats">
        <Metrica
          etiqueta="Huérfanos"
          valor={rec.huerfanos.total}
          nota="su cliente ya no está en Odoo"
          tono={rec.huerfanos.total > 0 ? 'atencion' : 'bien'}
        />
        <Metrica
          etiqueta="Desalineados"
          valor={rec.desalineados.total}
          nota="datos distintos entre sistemas"
          tono={rec.desalineados.total > 0 ? 'atencion' : 'bien'}
        />
        <Metrica
          etiqueta="Nunca sincronizados"
          valor={rec.nuncaSincronizados.total}
          nota="creados a mano"
        />
      </section>

      {rec.desalineados.total > 0 && (
        <section className="panel">
          <h2>Datos que no coinciden</h2>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Campo</th>
                  <th>En Odoo</th>
                  <th>En el panel</th>
                </tr>
              </thead>
              <tbody>
                {rec.desalineados.muestra.map((d, i) => (
                  <tr key={`${d.odooPartnerId}-${d.campo}-${i}`}>
                    <td>{d.nombre}</td>
                    <td>{d.campo}</td>
                    <td>{d.enOdoo ?? '—'}</td>
                    <td style={{ color: 'var(--danger)' }}>{d.enMiddleware ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Cómo se arregla</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
          La sincronización corre sola cada 15 minutos. Para lanzarla a mano:{' '}
          <code>pnpm sync:partners</code>. Los datos se corrigen <strong>en Odoo</strong>,
          nunca aquí: este panel es un espejo, y editarlo a mano crearía dos verdades.
        </p>
      </section>
    </Marco>
  );
}

function Marco({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          ASTA<span>Administración</span>
        </div>
        <div className="topbar-right">
          <span className="who">
            <strong>{nombre}</strong>
          </span>
          {/* La pantalla de sesiones no sirve de nada si hay que saberse la URL:
              quien sospecha de un acceso ajeno tiene que encontrarla mirando. */}
          <Link href="/cuenta/sesiones" className="btn-link">
            Sesiones
          </Link>
          <form action={salir}>
            <button type="submit" className="btn-link">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}
