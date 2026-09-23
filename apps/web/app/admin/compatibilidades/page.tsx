import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { getRevisionCompatibilidades, getCoberturaTop, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { RevisionLista } from './RevisionLista';
import { Pestanas } from './Pestanas';
import { Cobertura } from './Cobertura';

/**
 * Revisión de compatibilidades: qué producto de Odoo es, o sustituye a, qué
 * cartucho (#56).
 *
 * El recomendador del kiosco (#39) solo enseña lo que alguien validó aquí. Antes
 * de esta pantalla la única forma de validar era editar MySQL a mano, así que
 * el recomendador no podía devolver nada.
 *
 * Lo más vendido va primero: el top 20 de consumibles es el 39 % del importe, y
 * es sobre él que se mide si el kiosco sale.
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

export default async function CompatibilidadesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sesion = await requireSession();
  const params = await searchParams;
  const estado = ESTADOS.find((e) => e.valor === params.estado)?.valor ?? 'PROPUESTA';
  const marca = texto(params.marca);
  // Una sola letra la rechaza el middleware; aquí se ignora en vez de romper la pantalla.
  const q = texto(params.q) && texto(params.q)!.length >= 2 ? texto(params.q) : undefined;
  const pagina = Math.max(1, Number(params.pagina) || 1);

  let datos;
  let cobertura;
  try {
    // En paralelo: las dos leen ventas de Odoo, y la cache es la misma.
    [datos, cobertura] = await Promise.all([
      getRevisionCompatibilidades(sesion.accessToken, { estado, marca, q, pagina }),
      getCoberturaTop(sesion.accessToken),
    ]);
  } catch (error) {
    // `redirect()` funciona lanzando: si no se relanza, el catch se la traga.
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

  const { porEstado, totalProductos, porPagina, marcas } = datos.meta;
  const total = porEstado.PROPUESTA + porEstado.VALIDADA + porEstado.RECHAZADA;
  const paginas = Math.max(1, Math.ceil(totalProductos / porPagina));

  const enlace = (cambios: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    const todo = { estado, marca, q, ...cambios };
    for (const [k, v] of Object.entries(todo)) if (v !== undefined && v !== '' && !(k === 'pagina' && String(v) === '1')) qs.set(k, String(v));
    return `/admin/compatibilidades${qs.size ? `?${qs}` : ''}`;
  };

  return (
    <Marco
      usuario={sesion.usuario}
      titulo="Compatibilidades"
      descripcion="Qué producto es, o sustituye a, qué cartucho. El kiosco solo recomienda lo validado."
    >
      <Pestanas actual="productos" />

      <Cobertura datos={cobertura} />

      <section className="stats">
        <div className="stat">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: porEstado.PROPUESTA ? 'var(--warning)' : undefined }}>
            {porEstado.PROPUESTA.toLocaleString('es-VE')}
          </div>
          <div className="stat-sub">propuestas sin revisar</div>
        </div>
        <div className="stat">
          <div className="stat-label">Validadas</div>
          <div className="stat-value" style={{ color: 'var(--positive)' }}>
            {porEstado.VALIDADA.toLocaleString('es-VE')}
          </div>
          <div className="stat-sub">{!total ? 'nada cargado' : porEstado.VALIDADA > 0 && porEstado.VALIDADA / total < 0.01 ? 'menos del 1 % del total' : `${Math.round((porEstado.VALIDADA / total) * 100)} % del total`}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Rechazadas</div>
          <div className="stat-value">{porEstado.RECHAZADA.toLocaleString('es-VE')}</div>
          <div className="stat-sub">no se vuelven a proponer</div>
        </div>
      </section>

      <form className="filtros revision-filtros" action="/admin/compatibilidades" method="get">
        <input type="hidden" name="estado" value={estado} />
        <div className="filtro-campo">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Producto, referencia o cartucho" />
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
          {totalProductos.toLocaleString('es-VE')} {totalProductos === 1 ? 'producto' : 'productos'} · lo más vendido primero
        </span>
      </div>

      {datos.data.length === 0 ? (
        <div className="table-wrap">
          <div className="empty">
            {total === 0
              ? 'Todavía no hay propuestas. Se cargan con pnpm cartuchos:importar.'
              : q || marca
                ? 'Nada coincide con estos filtros.'
                : { PROPUESTA: 'No queda nada pendiente de revisar.', VALIDADA: 'Todavía no hay nada validado.', RECHAZADA: 'No hay nada rechazado.' }[estado]}
          </div>
        </div>
      ) : (
        // La key fuerza a vaciar la selección al cambiar de página o de filtro.
        <RevisionLista key={`${estado}|${marca}|${q}|${pagina}`} productos={datos.data} estado={estado} />
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
