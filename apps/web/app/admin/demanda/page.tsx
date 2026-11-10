import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { Marco } from '@/components/Marco';
import { Cifra } from '@/components/Cifras';
import { Periodos, fechasDe } from '@/components/Periodos';
import { Sedes, sedeDeParams } from '@/components/Sedes';
import { Proporcion } from '@/components/Reporte';
import { PestanasSeccion, PESTANAS_BUSQUEDAS } from '@/components/PestanasSeccion';
import { getDemandaAsta, ApiError, esRedireccion, ContractError } from '@/lib/api';
import { nombrePeriodo } from '@/lib/meses';
import { fecha } from '@/lib/formato';
import type { EstadoDemanda } from '@asta/shared-types';

/**
 * ASTA → Demanda: lo que la gente busca en la aplicación ASTA de las tiendas y
 * ASTA no tiene. Arriba, los cartuchos que habría que tener (lo que pide
 * Compras); debajo, las impresoras, con lo que falta en cada una: validar una
 * propuesta, conseguir el producto o averiguar qué cartucho usa.
 *
 * Mira las compatibilidades de HOY: una impresora que ya se cubrió no sale,
 * aunque se buscara cuando no lo estaba.
 */

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('es-VE');
const pct = (x: number) => `${x.toLocaleString('es-VE', { maximumFractionDigits: 0 })} %`;

const ESTADO: Record<Exclude<EstadoDemanda, 'CUBIERTA'>, { texto: string; clase: string; titulo: string }> = {
  POR_VALIDAR: { texto: 'Por validar', clase: 'demanda-validar', titulo: 'Hay un producto ASTA propuesto: valídalo en Compatibilidades' },
  SIN_ASTA: { texto: 'Sin ASTA', clase: 'demanda-sin-asta', titulo: 'Se sabe qué cartucho usa, pero ASTA no lo tiene' },
  SIN_DATOS: { texto: 'Sin datos', clase: 'demanda-sin-datos', titulo: 'No sabemos qué cartucho usa' },
};

export default async function DemandaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await requireSession();
  const params = await searchParams;
  const desde = typeof params.desde === 'string' ? params.desde : undefined;
  const hasta = typeof params.hasta === 'string' ? params.hasta : undefined;
  const periodo = desde && hasta ? { desde, hasta } : fechasDe('trimestre');
  const sede = sedeDeParams(params);

  let d;
  try {
    d = await getDemandaAsta(sesion.accessToken, periodo, sede);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    const esPermiso = error instanceof ApiError && error.status === 403;
    return (
      <Marco usuario={sesion.usuario} titulo="Búsquedas y demanda">
        <PestanasSeccion etiqueta="Búsquedas y demanda" pestanas={PESTANAS_BUSQUEDAS} actual="/admin/demanda" />
        <div className="notice error">
          <h2>{esPermiso ? 'Esta sección es solo para administradores' : 'No se pudo calcular la demanda'}</h2>
          <p>{error instanceof ContractError || error instanceof ApiError ? error.message : 'Error inesperado.'}</p>
        </div>
      </Marco>
    );
  }

  const t = d.totales;
  const nombre = nombrePeriodo(d.desde, d.hasta);
  const cobertura = t.conImpresora > 0 ? (t.cubiertas / t.conImpresora) * 100 : null;
  const maxCartucho = Math.max(0, ...d.cartuchos.map((c) => c.busquedas));
  const maxImpresora = Math.max(0, ...d.impresoras.map((i) => i.busquedas));

  return (
    <Marco usuario={sesion.usuario} titulo="Búsquedas y demanda">
      <PestanasSeccion etiqueta="Búsquedas y demanda" pestanas={PESTANAS_BUSQUEDAS} actual="/admin/demanda" />
      <Sedes base="/admin/demanda" sede={sede} periodo={periodo} />
      <Periodos base="/admin/demanda" periodo={periodo} sede={sede} />

      <section className="stats">
        <Cifra
          icono="diana"
          color="verde"
          etiqueta="Búsquedas con ASTA"
          valor={cobertura === null ? '—' : pct(cobertura)}
          nota={`${n(t.cubiertas)} de ${n(t.conImpresora)} en ${nombre}`}
        />
        <Cifra icono="alerta" color="ambar" etiqueta="Sin ASTA" valor={n(t.sinAsta)} tono={t.sinAsta > 0 ? 'atencion' : undefined} nota="búsquedas: falta el producto" />
        <Cifra icono="check" color="violeta" etiqueta="Por validar" valor={n(t.porValidar)} nota="búsquedas con un ASTA propuesto" />
        <Cifra icono="busqueda" etiqueta="Sin impresora" valor={n(t.sinImpresora)} nota="búsquedas que no encontraron ninguna" />
      </section>
      <p className="panel-nota">
        Mira las compatibilidades de hoy. Con una sede, solo cuentan las tablets de esa sede.{' '}
        {t.porValidar > 0 && (
          <>
            Las «Por validar» se arreglan en <Link href="/admin/compatibilidades">Compatibilidades</Link>.{' '}
          </>
        )}
        {t.sinImpresora > 0 && (
          <>
            Las búsquedas sin impresora (un alias que falta) están en la pestaña <Link href="/admin/recomendador">Búsquedas</Link>.
          </>
        )}
      </p>

      <section className="panel">
        <h2>Cartuchos que faltan en ASTA</h2>
        <p className="panel-nota">Los que usan las impresoras «Sin ASTA», por las búsquedas que cubrirían. Es la lista para Compras.</p>
        {d.cartuchos.length === 0 ? (
          <div className="empty">Ninguno en {nombre}.</div>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Cartucho</th>
                  <th>Búsquedas</th>
                  <th>Impresoras que lo usan</th>
                </tr>
              </thead>
              <tbody>
                {d.cartuchos.map((c) => (
                  <tr key={c.codigo}>
                    <td>
                      <strong>{c.codigo}</strong>
                      {c.marca && <div className="sku">{c.marca}</div>}
                    </td>
                    <td>
                      <Proporcion valor={c.busquedas} maximo={maxCartucho} texto={n(c.busquedas)} />
                    </td>
                    <td className="stat-sub demanda-impresoras">
                      {c.impresoras.slice(0, 4).join(' · ')}
                      {c.impresoras.length > 4 && ` y ${c.impresoras.length - 4} más`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Impresoras buscadas sin ASTA</h2>
        {d.impresoras.length === 0 ? (
          <div className="empty">Todo lo que se buscó en {nombre} tiene ASTA.</div>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Impresora</th>
                  <th>Qué falta</th>
                  <th>Búsquedas</th>
                  <th className="num">Tablets</th>
                  <th>Cartuchos</th>
                  <th>Última vez</th>
                </tr>
              </thead>
              <tbody>
                {d.impresoras.map((i) => {
                  const e = ESTADO[i.estado as Exclude<EstadoDemanda, 'CUBIERTA'>];
                  return (
                    <tr key={i.printerModelId}>
                      <td>
                        <strong>{i.nombre}</strong>
                        <div className="sku">{i.marca}</div>
                      </td>
                      <td>
                        <span className={`tag ${e.clase}`} title={e.titulo}>
                          {e.texto}
                        </span>
                      </td>
                      <td>
                        <Proporcion valor={i.busquedas} maximo={maxImpresora} texto={n(i.busquedas)} />
                      </td>
                      <td className="num">{i.tablets === 0 ? '—' : n(i.tablets)}</td>
                      <td className="stat-sub">{i.cartuchos.length ? i.cartuchos.join(', ') : '—'}</td>
                      <td className="stat-sub">{fecha(i.ultimaVez.slice(0, 10))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Marco>
  );
}
