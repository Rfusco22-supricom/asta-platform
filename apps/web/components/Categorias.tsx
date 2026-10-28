import Link from 'next/link';
import { cuotasDe, reglaDe, type CategoriasAsta, type ClaveCategoria } from '@asta/shared-types';
import { moneyCompact, moneyEntero } from '@/lib/formato';
import { mediaDe } from '@/lib/meses';
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
 * Los niveles de ASTA en el panel: su insignia y el avance hacia la meta (#131),
 * con cada cliente en su nivel del programa. Lo mismo para el administrador
 * (toda la empresa) y para el vendedor (su cartera). La tabla del trimestre, en
 * `ProgramaStaff`.
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

/**
 * Cuánto se compra al mes frente a la meta, y cada categoría frente a la suya.
 * `titulo` y `enlace` cambian entre el inicio y la página de categorías.
 */
export function CaminoMeta({ datos, enlace }: { datos: CategoriasAsta; enlace?: { href: string; texto: string } }) {
  const avance = datos.meta > 0 ? Math.min(100, (datos.compraMensual / datos.meta) * 100) : 0;
  const enPrograma = datos.porCategoria.filter((c) => c.categoria !== 'GENERAL').reduce((s, c) => s + c.clientes, 0);
  return (
    <section className="panel cat-meta">
      <div className="cat-meta-cabeza">
        <div>
          <h2>Camino a {moneyEntero(datos.meta)} al mes</h2>
          <p className="panel-nota">{n(enPrograma)} clientes en el programa</p>
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
            de {moneyCompact(datos.meta)} al mes · faltan {moneyCompact(Math.max(0, datos.meta - datos.compraMensual))} · {mediaDe(datos.meses)}
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
                {c.categoria === 'GENERAL'
                  ? `sube a Bronce con ${moneyEntero(cuotasDe('BRONCE').mensual)}/mes`
                  : `cuota ${moneyEntero(cuotasDe(c.categoria).mensual)}/mes y ${moneyEntero(cuotasDe(c.categoria).trimestral)}/trimestre`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
