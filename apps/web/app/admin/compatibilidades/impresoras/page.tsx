import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { FormularioCompatibilidad } from '@/components/FormularioCompatibilidad';
import { getRevisionImpresoras, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { Pestanas } from '../Pestanas';
import { RevisionImpresoras } from './RevisionImpresoras';

/**
 * Compatibilidades → Impresoras: a qué impresora le sirve cada cartucho (#56).
 *
 * Aquí se revisa lo que trajo el importador de `compatibilidad_productos` y lo
 * que proponen los vendedores, y se añade lo que falta. Lo añadido por un
 * administrador queda validado.
 */

export const dynamic = 'force-dynamic';

const ESTADOS = [
  { valor: 'PROPUESTA', titulo: 'Pendientes' },
  { valor: 'VALIDADA', titulo: 'Validadas' },
  { valor: 'RECHAZADA', titulo: 'Rechazadas' },
] as const;

function texto(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export default async function ImpresorasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requireSession();
  const params = await searchParams;
  const estado = ESTADOS.find((e) => e.valor === params.estado)?.valor ?? 'PROPUESTA';
  const marca = texto(params.marca);
  const q = texto(params.q) && texto(params.q)!.length >= 2 ? texto(params.q) : undefined;
  const pagina = Math.max(1, Number(params.pagina) || 1);

  let datos;
  try {
    datos = await getRevisionImpresoras(sesion.accessToken, { estado, marca, q, pagina });
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Compatibilidades">
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo cargar'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const { porEstado, totalCartuchos, porPagina, marcas } = datos.meta;
  const total = porEstado.PROPUESTA + porEstado.VALIDADA + porEstado.RECHAZADA;
  const paginas = Math.max(1, Math.ceil(totalCartuchos / porPagina));
  const enlace = (cambios: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ estado, marca, q, ...cambios })) {
      if (v !== undefined && v !== '' && !(k === 'pagina' && String(v) === '1')) qs.set(k, String(v));
    }
    return `/admin/compatibilidades/impresoras${qs.size ? `?${qs}` : ''}`;
  };

  return (
    <Marco usuario={sesion.usuario} titulo="Compatibilidades" descripcion="Qué cartucho le sirve a cada impresora. El kiosco solo recomienda lo validado.">
      <Pestanas actual="impresoras" />

      <section className="stats">
        <div className="stat">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: porEstado.PROPUESTA ? 'var(--warning)' : undefined }}>
            {porEstado.PROPUESTA.toLocaleString('es-VE')}
          </div>
          <div className="stat-sub">impresora ↔ cartucho sin revisar</div>
        </div>
        <div className="stat">
          <div className="stat-label">Validadas</div>
          <div className="stat-value" style={{ color: 'var(--positive)' }}>
            {porEstado.VALIDADA.toLocaleString('es-VE')}
          </div>
          <div className="stat-sub">
            {!total ? 'nada cargado' : porEstado.VALIDADA > 0 && porEstado.VALIDADA / total < 0.01 ? 'menos del 1 % del total' : `${Math.round((porEstado.VALIDADA / total) * 100)} % del total`}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Rechazadas</div>
          <div className="stat-value">{porEstado.RECHAZADA.toLocaleString('es-VE')}</div>
          <div className="stat-sub">no se vuelven a proponer</div>
        </div>
      </section>

      <FormularioCompatibilidad como="admin" marcas={marcas} />

      <form className="filtros revision-filtros" action="/admin/compatibilidades/impresoras" method="get">
        <input type="hidden" name="estado" value={estado} />
        <div className="filtro-campo">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Impresora o cartucho: m404, CF258A" />
        </div>
        <div className="filtro-campo">
          <label htmlFor="marca">Marca del cartucho</label>
          <select id="marca" name="marca" className="select" defaultValue={marca ?? ''}>
            <option value="">Todas</option>
            {marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-inline" type="submit">
          Filtrar
        </button>
        {(q || marca) && (
          <Link className="btn-link" href={enlace({ q: undefined, marca: undefined, pagina: undefined })}>
            Quitar filtros
          </Link>
        )}
      </form>

      <div className="toolbar">
        <nav className="segmented" aria-label="Estado">
          {ESTADOS.map((e) => (
            <Link key={e.valor} href={enlace({ estado: e.valor, pagina: undefined })} aria-current={e.valor === estado ? 'page' : undefined} className="segmented-enlace">
              {e.titulo}
            </Link>
          ))}
        </nav>
        <span className="count">
          {totalCartuchos.toLocaleString('es-VE')} {totalCartuchos === 1 ? 'cartucho' : 'cartuchos'} · lo más vendido primero
        </span>
      </div>

      {datos.data.length === 0 ? (
        <div className="table-wrap">
          <div className="empty">
            {total === 0
              ? 'Todavía no hay compatibilidades. Se cargan con importar-compatibilidades, o se añaden con el formulario de arriba.'
              : q || marca
                ? 'Nada coincide con estos filtros.'
                : { PROPUESTA: 'No queda nada pendiente de revisar.', VALIDADA: 'Todavía no hay nada validado.', RECHAZADA: 'No hay nada rechazado.' }[estado]}
          </div>
        </div>
      ) : (
        <RevisionImpresoras key={`${estado}|${marca}|${q}|${pagina}`} cartuchos={datos.data} estado={estado} />
      )}

      {paginas > 1 && (
        <nav className="paginacion" aria-label="Páginas">
          {pagina > 1 ? <Link href={enlace({ pagina: pagina - 1 })}>← Anterior</Link> : <span />}
          <span>
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas ? <Link href={enlace({ pagina: pagina + 1 })}>Siguiente →</Link> : <span />}
        </nav>
      )}
    </Marco>
  );
}
