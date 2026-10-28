import Link from 'next/link';
import { cuotasDe, reglaDe, type CategoriasAsta, type ClaveCategoria } from '@asta/shared-types';
import { COLORES_CATEGORIAS } from '@/components/tres/colores';
import { esRedireccion, type Reporte } from '@/lib/api';
import { moneyCompact, moneyEntero } from '@/lib/formato';
import { PiramideCategorias, type NivelPiramide } from './PiramideCategorias';

/**
 * Las piezas comunes de los dos Inicios: el del administrador (`/admin`, toda la
 * empresa) y el del vendedor (`/inicio`, su cartera).
 *
 * Cada bloque de un Inicio es una lectura aparte con su `Suspense`: la página
 * sale enseguida y cada bloque llega cuando responde Odoo. Si uno falla, lo
 * dice ese bloque (`Fallo`) y los demás siguen.
 */

export const n = (x: number) => x.toLocaleString('es-VE');
export const facturas = (x: number) => `${n(x)} ${x === 1 ? 'factura' : 'facturas'}`;
export const pct = (x: number) => `${x.toLocaleString('es-VE', { maximumFractionDigits: 1 })} %`;
/** Compacto a partir de 10.000 y entero por debajo, como en `Categorias.tsx`. */
export const corto = (x: number) => (Math.abs(x) >= 10_000 ? moneyCompact(x) : moneyEntero(x));

/** Lee, y si falla devuelve `null` para que el bloque lo diga. Las redirecciones (sesión caducada) siguen su camino. */
export async function intentar<T>(leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return null;
  }
}

export function Fallo({ area, titulo }: { area: string; titulo: string }) {
  return (
    <section className={`panel dash-${area} dash-fallo`}>
      <h2>{titulo}</h2>
      <p className="panel-nota">No se pudo leer de Odoo ahora. Recarga en un momento.</p>
    </section>
  );
}

export function Esqueleto({ area, alto = 120 }: { area: string; alto?: number }) {
  return <div className={`panel dash-${area} dash-esqueleto`} style={{ minHeight: alto }} aria-busy="true" />;
}

/** El último mes COMPLETO frente al anterior: el mes en curso todavía no se puede comparar. */
export function ultimoMes(serie: Reporte['serieMensual']) {
  const hoy = new Date().toISOString().slice(0, 7);
  const completos = serie.filter((p) => p.periodo < hoy);
  const ultimo = completos.at(-1);
  const previo = completos.at(-2);
  if (!ultimo) return null;
  const cambio = previo && previo.monto > 0 ? ((ultimo.monto - previo.monto) / previo.monto) * 100 : null;
  return { ultimo, previo, cambio };
}

/** De abajo arriba, como las láminas de la pirámide. */
const DE_ABAJO_ARRIBA: ClaveCategoria[] = ['GENERAL', 'BRONCE', 'PLATA', 'ORO', 'DIAMANTE'];

/**
 * El camino a la meta con la pirámide de categorías en 3D (#131).
 *
 * ── Dos lecturas de los mismos datos ─────────────────────────────────────────
 *
 *   · `empresa` (administrador): la compra de ASTA de todos frente a la meta de
 *     100.000 al mes, y cada categoría frente a sus metas de clientes y compra.
 *   · `cartera` (vendedor): lo que compra SU cartera y cuánto aporta a la meta
 *     de la empresa. Las metas por categoría son de la empresa entera y no se
 *     le enseñan: a un vendedor «0 de 6 Diamante» le diría que va mal cuando
 *     esa meta no es suya. En su lugar, qué parte de su cartera pone cada una.
 */
export function HeroMeta({ datos: r, alcance, base }: { datos: CategoriasAsta; alcance: 'empresa' | 'cartera'; base: string }) {
  const enCartera = alcance === 'cartera';
  const avance = r.meta > 0 ? Math.min(100, (r.compraMensual / r.meta) * 100) : 0;
  const enPrograma = r.porCategoria.filter((c) => c.categoria !== 'GENERAL').reduce((s, c) => s + c.clientes, 0);
  const porClave = new Map(r.porCategoria.map((c) => [c.categoria, c]));
  // En la cartera, la barra es el 100 % de lo que compra; en la empresa, la meta.
  const total = enCartera ? r.compraMensual : r.meta;

  const niveles: NivelPiramide[] = DE_ABAJO_ARRIBA.map((clave, i) => {
    const c = porClave.get(clave);
    const regla = reglaDe(clave);
    const clientes = c?.clientes ?? 0;
    const metaClientes = c?.metaClientes ?? null;
    const parte = r.compraMensual > 0 ? ((c?.compraMensual ?? 0) / r.compraMensual) * 100 : 0;
    return {
      clave,
      nombre: regla.nombre,
      color: COLORES_CATEGORIAS[i]!,
      clientes: enCartera || metaClientes === null ? `${n(clientes)} ${clientes === 1 ? 'cliente' : 'clientes'}` : `${n(clientes)} de ${n(metaClientes)} clientes`,
      compra: `${corto(c?.compraMensual ?? 0)} al mes`,
      meta: enCartera ? `${pct(parte)} de lo que compra tu cartera` : `meta ${corto(c?.metaCompraMensual ?? 0)} al mes`,
      regla:
        clave === 'GENERAL'
          ? `sube a Bronce con ${moneyEntero(cuotasDe('BRONCE').mensual)}/mes`
          : `cuota ${moneyEntero(cuotasDe(clave).mensual)}/mes y ${moneyEntero(cuotasDe(clave).trimestral)}/trimestre`,
      avance: enCartera ? (r.compraMensual > 0 ? Math.min(100, parte) : null) : metaClientes ? Math.min(100, (clientes / metaClientes) * 100) : null,
      href: `${base}?ver=${clave}`,
    };
  });

  return (
    <section className="panel dash-meta hero-meta">
      <div className="hero-texto">
        <span className="hero-etiqueta">{enCartera ? 'Tu cartera en ASTA' : `Camino a ${moneyEntero(r.meta)} al mes`}</span>
        <div className="hero-cifra">
          <strong>{corto(r.compraMensual)}</strong>
          <span>{enCartera ? 'al mes en ASTA' : `de ${moneyCompact(r.meta)} al mes`}</span>
        </div>

        {/* Cuánto pone cada categoría: un tramo de su color por categoría. */}
        <div
          className="hero-barra"
          role={enCartera ? 'img' : 'progressbar'}
          aria-valuemin={enCartera ? undefined : 0}
          aria-valuemax={enCartera ? undefined : 100}
          aria-valuenow={enCartera ? undefined : Math.round(avance)}
          aria-label={enCartera ? 'Lo que pone cada categoría' : 'Avance hacia la meta'}
        >
          {[...niveles].reverse().map((nv) => {
            const c = porClave.get(nv.clave as ClaveCategoria);
            const ancho = total > 0 ? ((c?.compraMensual ?? 0) / total) * 100 : 0;
            return ancho > 0 ? <span key={nv.clave} style={{ width: `${ancho}%`, background: nv.color }} title={`${nv.nombre}: ${nv.compra}`} /> : null;
          })}
        </div>

        <p className="hero-nota">
          {enCartera ? (
            <>
              Aporta el <strong>{pct(avance)}</strong> de la meta de la empresa, {moneyEntero(r.meta)} al mes.
            </>
          ) : (
            <>
              Faltan <strong>{moneyCompact(Math.max(0, r.meta - r.compraMensual))}</strong> al mes.
            </>
          )}{' '}
          {n(enPrograma)} {enPrograma === 1 ? 'cliente' : 'clientes'} en el programa.
        </p>

        <div className="hero-acciones">
          <Link className="btn btn-inline" href={`${base}?ver=juego`}>
            Ver quién está en juego este trimestre
          </Link>
          <Link className="dash-mas" href={base}>
            Todo el programa →
          </Link>
        </div>
      </div>

      <PiramideCategorias niveles={niveles} />
    </section>
  );
}
