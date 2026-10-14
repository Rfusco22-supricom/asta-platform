import Link from 'next/link';
import { reglaDe, type CategoriasAsta, type ClaveCategoria, type ClienteCategoria } from '@asta/shared-types';
import { money, moneyCompact, moneyEntero } from '@/lib/formato';
import { etiquetaMes } from '@/components/Reporte';
import { COLORES_CATEGORIAS } from '@/components/tres/colores';

/** El color de cada categoría, el mismo que su lámina en la pirámide 3D del Inicio. */
const COLOR: Record<ClaveCategoria, string> = {
  GENERAL: COLORES_CATEGORIAS[0]!,
  BRONCE: COLORES_CATEGORIAS[1]!,
  PLATA: COLORES_CATEGORIAS[2]!,
  ORO: COLORES_CATEGORIAS[3]!,
  DIAMANTE: COLORES_CATEGORIAS[4]!,
};

/**
 * Las categorías de ASTA (#131) en el panel: el avance hacia la meta y la lista
 * de clientes. Lo mismo para el administrador (toda la empresa) y para el
 * vendedor (su cartera): cambia lo que llega, no cómo se enseña.
 */

const n = (x: number) => x.toLocaleString('es-VE');
/** Compacto a partir de 10.000 y entero por debajo: nunca «7.053,38» junto a «15,4 k». */
const corto = (x: number) => (Math.abs(x) >= 10_000 ? moneyCompact(x) : moneyEntero(x));

const ICONO: Record<ClaveCategoria, string> = { DIAMANTE: '💎', ORO: '🥇', PLATA: '🥈', BRONCE: '🥉', GENERAL: '·' };

export function InsigniaCategoria({ categoria }: { categoria: ClaveCategoria }) {
  return (
    <span className={`cat-insignia cat-${categoria.toLowerCase()}`}>
      <span aria-hidden="true">{ICONO[categoria]}</span> {reglaDe(categoria).nombre}
    </span>
  );
}

/** «jun–sep 2026». */
export function ventana(meses: string[]): string {
  if (meses.length === 0) return '';
  const [a, b] = [etiquetaMes(meses[0]!), etiquetaMes(meses.at(-1)!)];
  return `${a.split(' ')[0]}–${b}`;
}

/**
 * Cuánto se compra al mes frente a la meta, y cada categoría frente a la suya.
 * `titulo` y `enlace` cambian entre el inicio y la página de categorías.
 */
export function CaminoMeta({ datos, enlace, alcance }: { datos: CategoriasAsta; enlace?: { href: string; texto: string }; alcance: string }) {
  const avance = datos.meta > 0 ? Math.min(100, (datos.compraMensual / datos.meta) * 100) : 0;
  const enPrograma = datos.porCategoria.filter((c) => c.categoria !== 'GENERAL').reduce((s, c) => s + c.clientes, 0);
  return (
    <section className="panel cat-meta">
      <div className="cat-meta-cabeza">
        <div>
          <h2>Camino a {moneyEntero(datos.meta)} USD/mes</h2>
          <p className="panel-nota">
            {alcance} · promedio de ASTA de {ventana(datos.meses)}, sin IVA · {n(enPrograma)} clientes en el programa
          </p>
        </div>
        {enlace && (
          <Link className="dash-mas" href={enlace.href}>
            {enlace.texto} →
          </Link>
        )}
      </div>

      <div className="cat-avance">
        <div className="cat-avance-cifras">
          <strong>{moneyCompact(datos.compraMensual)}</strong>
          <span>
            de {moneyCompact(datos.meta)} al mes · faltan {moneyCompact(Math.max(0, datos.meta - datos.compraMensual))}
          </span>
        </div>
        {/* Un tramo por categoría, del ancho de lo que pone: se ve quién empuja. */}
        <div className="cat-avance-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(avance)}>
          {datos.porCategoria.map((c) => {
            const ancho = datos.meta > 0 ? (c.compraMensual / datos.meta) * 100 : 0;
            return ancho > 0 ? (
              <span key={c.categoria} style={{ width: `${ancho}%`, background: COLOR[c.categoria] }} title={`${reglaDe(c.categoria).nombre}: ${corto(c.compraMensual)}/mes`} />
            ) : null;
          })}
        </div>
      </div>

      <div className="cat-niveles">
        {datos.porCategoria.map((c) => {
          const regla = reglaDe(c.categoria);
          const pctClientes = c.metaClientes ? Math.min(100, (c.clientes / c.metaClientes) * 100) : null;
          return (
            <div key={c.categoria} className={`cat-nivel cat-${c.categoria.toLowerCase()}`}>
              <InsigniaCategoria categoria={c.categoria} />
              <div className="cat-nivel-cifra">
                <strong>{n(c.clientes)}</strong>
                {c.metaClientes !== null && <span> de {n(c.metaClientes)}</span>}
              </div>
              {pctClientes !== null && (
                <div className="cat-nivel-barra" aria-hidden="true">
                  <span style={{ width: `${pctClientes}%` }} />
                </div>
              )}
              <div className="stat-sub">
                {corto(c.compraMensual)}/mes · meta {corto(c.metaCompraMensual)}
              </div>
              <div className="cat-nivel-regla">
                {regla.minimoMensual > 0 ? `≥ ${moneyEntero(regla.minimoMensual)}/mes y ${regla.minimoMeses} de 4 meses` : `< ${moneyEntero(reglaDe('BRONCE').minimoMensual)}/mes`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ParaSubir({ c }: { c: ClienteCategoria }) {
  if (!c.siguiente) return <span className="stat-sub">en lo más alto</span>;
  const partes: string[] = [];
  if (c.siguiente.faltaMensual > 0) partes.push(`+${moneyEntero(c.siguiente.faltaMensual)}/mes`);
  if (c.siguiente.faltanMeses > 0) partes.push(`${c.siguiente.faltanMeses} ${c.siguiente.faltanMeses === 1 ? 'mes' : 'meses'} más con compra`);
  return (
    <span className="cat-subir">
      {partes.join(' y ')} <span className="stat-sub">para {reglaDe(c.siguiente.categoria).nombre}</span>
    </span>
  );
}

/** Las compras de los cuatro meses, como barras: se ve si compra seguido o de golpe. */
function Meses({ c, meses }: { c: ClienteCategoria; meses: string[] }) {
  const max = Math.max(...c.porMes, 1);
  return (
    <span className="cat-meses" title={c.porMes.map((x, i) => `${etiquetaMes(meses[i]!)}: ${money(x)}`).join(' · ')}>
      {c.porMes.map((x, i) => (
        <i key={i} className={x > 0 ? '' : 'vacio'} style={{ height: `${x > 0 ? Math.max(18, (x / max) * 100) : 100}%` }} />
      ))}
      <b>{c.mesesConCompra}/4</b>
    </span>
  );
}

export const FILTROS = [
  { valor: 'programa', titulo: 'En el programa' },
  { valor: 'cerca', titulo: 'Cerca de subir' },
  { valor: 'DIAMANTE', titulo: 'Diamante' },
  { valor: 'ORO', titulo: 'Oro' },
  { valor: 'PLATA', titulo: 'Plata' },
  { valor: 'BRONCE', titulo: 'Bronce' },
  { valor: 'GENERAL', titulo: 'Cliente general' },
] as const;

/**
 * «Cerca de subir»: le falta un mes con compra, o menos del 25 % de lo que pide
 * la categoría siguiente. Es la lista para llamar esta semana.
 */
export function estaCerca(c: ClienteCategoria): boolean {
  if (!c.siguiente) return false;
  const minimo = reglaDe(c.siguiente.categoria).minimoMensual;
  const poco = c.siguiente.faltaMensual === 0 || c.siguiente.faltaMensual <= minimo * 0.25;
  return poco && c.siguiente.faltanMeses <= 1;
}

export function filtrar(clientes: ClienteCategoria[], filtro: string): ClienteCategoria[] {
  if (filtro === 'programa') return clientes.filter((c) => c.categoria !== 'GENERAL');
  if (filtro === 'cerca') return clientes.filter(estaCerca).sort((a, b) => (a.siguiente?.faltaMensual ?? 0) - (b.siguiente?.faltaMensual ?? 0));
  return clientes.filter((c) => c.categoria === filtro);
}

export function TablaCategorias({
  datos,
  filtro,
  base,
  conVendedor,
}: {
  datos: CategoriasAsta;
  filtro: string;
  base: string;
  conVendedor: boolean;
}) {
  const filas = filtrar(datos.clientes, filtro);
  const cuenta = (v: string) => filtrar(datos.clientes, v).length;
  return (
    <>
      <nav className="pi-vistas cat-filtros" aria-label="Qué clientes ver">
        {FILTROS.map((f) => (
          <Link key={f.valor} href={`${base}?ver=${f.valor}`} aria-current={f.valor === filtro ? 'page' : undefined}>
            {f.titulo}
            <span className="pi-cuenta">{n(cuenta(f.valor))}</span>
          </Link>
        ))}
      </nav>

      {filas.length === 0 ? (
        <div className="table-wrap">
          <div className="empty">Ningún cliente en esta lista.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tabla-tarjetas tabla-categorias">
            <thead>
              <tr>
                <th>Cliente</th>
                {conVendedor && <th>Vendedor</th>}
                <th>Categoría</th>
                <th className="num">Compra mensual</th>
                <th>Meses</th>
                <th>Para subir</th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, 300).map((c) => (
                <tr key={c.clave}>
                  <td className="c-cliente">
                    <Link href={`/cartera/${c.partnerId}`} className="cliente-nombre enlace-ficha">
                      {c.nombre}
                    </Link>
                    {c.rif && <div className="cliente-contacto">{c.rif}</div>}
                  </td>
                  {conVendedor && (
                    <td data-etiqueta="Vendedor">{c.vendedor ?? <span className="stat-sub">sin vendedor</span>}</td>
                  )}
                  <td data-etiqueta="Categoría">
                    <InsigniaCategoria categoria={c.categoria} />
                  </td>
                  <td className="num" data-etiqueta="Compra mensual" title={money(c.compraMensual)}>
                    {moneyEntero(c.compraMensual)}
                  </td>
                  <td data-etiqueta={`Meses (${ventana(datos.meses)})`}>
                    <Meses c={c} meses={datos.meses} />
                  </td>
                  <td data-etiqueta="Para subir">
                    <ParaSubir c={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filas.length > 300 && <p className="stat-sub">Se muestran los 300 de más compra de {n(filas.length)}.</p>}
    </>
  );
}
