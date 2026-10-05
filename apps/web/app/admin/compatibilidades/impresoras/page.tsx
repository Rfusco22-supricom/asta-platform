import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { FormularioCompatibilidad } from '@/components/FormularioCompatibilidad';
import { getLoteFabricante, getPorImpresora, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { AvisoOdoo } from '../AvisoOdoo';
import { Pestanas } from '../Pestanas';
import { TonersPorImpresora } from './TonersPorImpresora';
import { LoteFabricante } from './LoteFabricante';

/**
 * Compatibilidades → Impresoras: «Impresora | Tóners compatibles» (#56).
 *
 * Una fila por impresora, con sus tóners en un selector. Lo sugerido viene de
 * las listas del fabricante, de `compatibilidad_productos` y de los vendedores;
 * aquí se marca lo que sirve, se busca o se crea lo que falta, y se guarda.
 *
 * La impresora que no existe todavía se añade con el formulario de abajo.
 */

export const dynamic = 'force-dynamic';

const VISTAS = [
  { valor: 'por_revisar', titulo: 'Por revisar', vacio: 'No queda ninguna impresora con sugerencias por revisar.' },
  { valor: 'sin_toner', titulo: 'Sin tóner', vacio: 'Todas las impresoras tienen algún tóner.' },
  { valor: 'listas', titulo: 'Listas', vacio: 'Todavía no hay ninguna impresora con tóner validado.' },
  { valor: 'todas', titulo: 'Todas', vacio: 'No hay impresoras cargadas.' },
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
  const vista = VISTAS.find((v) => v.valor === params.vista)?.valor ?? 'por_revisar';
  const marca = texto(params.marca);
  // Desde la cobertura del top se llega con `?cartucho=`: las impresoras de ese tóner.
  const cartucho = texto(params.cartucho);
  const buscado = texto(params.q) ?? cartucho;
  const q = buscado && buscado.length >= 2 ? buscado : undefined;
  const pagina = Math.max(1, Number(params.pagina) || 1);

  let datos;
  // El aviso del lote no puede tumbar la página: sin él, se revisa una a una como antes.
  const lote = await getLoteFabricante(sesion.accessToken).catch((e) => {
    if (esRedireccion(e)) throw e;
    return null;
  });
  try {
    // Con un tóner buscado se mira en todas: puede estar ya validado.
    datos = await getPorImpresora(sesion.accessToken, { vista: cartucho && !params.vista ? 'todas' : vista, marca, q, pagina });
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

  const vistaActual = cartucho && !params.vista ? 'todas' : vista;
  const { porVista, total, porPagina, marcas, odooDisponible } = datos.meta;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const conToner = porVista.listas + porVista.por_revisar;
  const avance = porVista.todas ? Math.round((porVista.listas / porVista.todas) * 100) : 0;
  const enlace = (cambios: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ vista: vistaActual, marca, q, ...cambios })) {
      if (v !== undefined && v !== '' && !(k === 'pagina' && String(v) === '1') && !(k === 'vista' && v === 'por_revisar')) qs.set(k, String(v));
    }
    return `/admin/compatibilidades/impresoras${qs.size ? `?${qs}` : ''}`;
  };

  return (
    <Marco usuario={sesion.usuario} titulo="Compatibilidades" descripcion="Qué tóner le sirve a cada impresora. El kiosco solo recomienda lo validado, y solo ofrece ASTA.">
      <Pestanas actual="impresoras" />

      {!odooDisponible && <AvisoOdoo />}

      {lote && lote.propuestas > 0 && <LoteFabricante lote={lote} />}

      <section className="pi-avance" aria-label="Avance de la revisión">
        <div className="pi-avance-texto">
          <strong>{porVista.listas.toLocaleString('es-VE')}</strong> de {porVista.todas.toLocaleString('es-VE')} impresoras listas
          {(q || marca) && <span className="pi-avance-filtro"> · con estos filtros</span>}
        </div>
        <div className="pi-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avance} aria-label="Impresoras listas">
          <span className="listas" style={{ width: `${porVista.todas ? (porVista.listas / porVista.todas) * 100 : 0}%` }} />
          <span className="revisar" style={{ width: `${porVista.todas ? (porVista.por_revisar / porVista.todas) * 100 : 0}%` }} />
        </div>
        <div className="pi-leyenda">
          <span><i className="listas" /> Listas {porVista.listas}</span>
          <span><i className="revisar" /> Por revisar {porVista.por_revisar}</span>
          <span><i className="sin" /> Sin tóner {porVista.sin_toner}</span>
          <span className="pi-leyenda-nota">{conToner} con algún tóner</span>
        </div>
      </section>

      <div className="pi-barra-herramientas">
        <nav className="pi-vistas" aria-label="Qué impresoras ver">
          {VISTAS.map((v) => (
            <Link key={v.valor} href={enlace({ vista: v.valor, pagina: undefined })} aria-current={v.valor === vistaActual ? 'page' : undefined}>
              {v.titulo}
              <span className="pi-cuenta">{porVista[v.valor].toLocaleString('es-VE')}</span>
            </Link>
          ))}
        </nav>

        <form className="pi-filtros" action="/admin/compatibilidades/impresoras" method="get" role="search">
          {vistaActual !== 'por_revisar' && <input type="hidden" name="vista" value={vistaActual} />}
          <label className="pi-buscar">
            <span className="sr-only">Buscar impresora o tóner</span>
            <span className="pi-lupa" aria-hidden="true">⌕</span>
            <input name="q" className="input" defaultValue={q} placeholder="Impresora o tóner: M404, L3110, CF258A" />
          </label>
          <select name="marca" className="select" defaultValue={marca ?? ''} aria-label="Marca de la impresora">
            <option value="">Todas las marcas</option>
            {marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button className="btn btn-inline" type="submit">
            Buscar
          </button>
          {(q || marca) && (
            <Link className="btn-link" href={enlace({ q: undefined, marca: undefined, pagina: undefined })}>
              Quitar filtros
            </Link>
          )}
        </form>
      </div>

      {datos.data.length === 0 ? (
        <div className="table-wrap">
          <div className="empty">{q || marca ? 'Ninguna impresora coincide con estos filtros.' : VISTAS.find((v) => v.valor === vistaActual)!.vacio}</div>
        </div>
      ) : (
        <TonersPorImpresora key={`${vistaActual}|${marca}|${q}|${pagina}`} impresoras={datos.data} odooDisponible={odooDisponible} marcas={marcas} />
      )}

      {paginas > 1 && (
        <nav className="paginacion" aria-label="Páginas">
          {pagina > 1 ? <Link href={enlace({ pagina: pagina - 1 })}>← Anterior</Link> : <span />}
          <span>
            Página {pagina} de {paginas} · {total.toLocaleString('es-VE')} impresoras
          </span>
          {pagina < paginas ? <Link href={enlace({ pagina: pagina + 1 })}>Siguiente →</Link> : <span />}
        </nav>
      )}

      <details className="pi-falta" open={Boolean(cartucho) && datos.data.length === 0}>
        <summary>¿Falta una impresora? Añádela con su tóner</summary>
        <FormularioCompatibilidad como="admin" marcas={marcas} codigoInicial={cartucho} />
      </details>
    </Marco>
  );
}
